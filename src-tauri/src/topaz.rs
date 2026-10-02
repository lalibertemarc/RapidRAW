use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::SystemTime;

use rawler::decoders::{RawDecodeParams, WellKnownIFD};
use rawler::rawsource::RawSource;
use rawler::tags::{DngTag, TiffCommonTag};
use serde_json::Value;
use tauri::AppHandle;

use crate::app_settings::load_settings;
use crate::file_management::parse_virtual_path;
use crate::formats::is_raw_file;

const DEFAULT_TOPAZ_PATH: &str =
    r"C:\Program Files\Topaz Labs LLC\Topaz Photo AI\Topaz Photo AI.exe";

fn is_dng(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("dng"))
}

fn snapshot_dngs(dir: &Path) -> HashMap<PathBuf, SystemTime> {
    fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| is_dng(path))
        .filter_map(|path| {
            let modified = fs::metadata(&path).and_then(|m| m.modified()).ok()?;
            Some((path, modified))
        })
        .collect()
}

fn sorted_sides(w: usize, h: usize) -> (usize, usize) {
    (w.max(h), w.min(h))
}

fn raw_size(path: &Path) -> Option<(usize, usize)> {
    let source = RawSource::new(path).ok()?;
    let decoder = rawler::get_decoder(&source).ok()?;
    let raw = decoder
        .raw_image(&source, &RawDecodeParams::default(), true)
        .ok()?;
    let (w, h) = raw
        .crop_area
        .map_or((raw.width, raw.height), |area| (area.d.w, area.d.h));
    Some(sorted_sides(w, h))
}

fn dng_size(path: &Path) -> Option<(usize, usize)> {
    let source = RawSource::new(path).ok()?;
    let decoder = rawler::get_decoder(&source).ok()?;
    let ifd = decoder.ifd(WellKnownIFD::Raw).ok()??;
    let (w, h) = match ifd.get_entry(DngTag::DefaultCropSize) {
        Some(size) => (size.force_usize(0), size.force_usize(1)),
        None => (
            ifd.get_entry(TiffCommonTag::ImageWidth)?.force_usize(0),
            ifd.get_entry(TiffCommonTag::ImageLength)?.force_usize(0),
        ),
    };
    Some(sorted_sides(w, h))
}

fn was_resized(source: &Path, output: &Path) -> bool {
    let (Some(before), Some(after)) = (raw_size(source), dng_size(output)) else {
        return false;
    };
    let differs = |a: usize, b: usize| a.abs_diff(b) as f64 > a as f64 * 0.05;
    differs(before.0, after.0) || differs(before.1, after.1)
}

fn copy_sidecar(source: &Path, dest: &Path, drop_crop: bool) -> Result<(), String> {
    if !drop_crop {
        return fs::copy(source, dest)
            .map(|_| ())
            .map_err(|e| e.to_string());
    }
    let content = fs::read_to_string(source).map_err(|e| e.to_string())?;
    let mut metadata: Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    if let Some(adjustments) = metadata
        .get_mut("adjustments")
        .and_then(|a| a.as_object_mut())
    {
        adjustments.insert("crop".to_string(), Value::Null);
    }
    let json = serde_json::to_string_pretty(&metadata).map_err(|e| e.to_string())?;
    fs::write(dest, json).map_err(|e| e.to_string())
}

fn unique_output_path(dir: &Path, stem: &str) -> PathBuf {
    let mut candidate = dir.join(format!("{}_Topaz.dng", stem));
    let mut index = 2;
    while candidate.exists() {
        candidate = dir.join(format!("{}_Topaz-{}.dng", stem, index));
        index += 1;
    }
    candidate
}

#[tauri::command]
pub async fn edit_in_topaz(path: String, app_handle: AppHandle) -> Result<Option<String>, String> {
    let (source_path, source_sidecar) = parse_virtual_path(&path);
    if !is_raw_file(&source_path) || is_dng(&source_path) {
        return Err("Only RAW files can be sent to Topaz Photo AI.".to_string());
    }

    let exe = load_settings(app_handle)?
        .topaz_path
        .filter(|p| !p.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_TOPAZ_PATH.to_string());
    if !Path::new(&exe).is_file() {
        return Err(format!(
            "Topaz Photo AI not found at {}. Set its path in Settings.",
            exe
        ));
    }

    let dir = source_path
        .parent()
        .ok_or_else(|| "Could not determine parent directory.".to_string())?
        .to_path_buf();

    tokio::task::spawn_blocking(move || {
        let before = snapshot_dngs(&dir);

        Command::new(&exe)
            .arg(&source_path)
            .status()
            .map_err(|e| format!("Failed to launch Topaz Photo AI: {}", e))?;

        let Some(topaz_output) = snapshot_dngs(&dir)
            .into_iter()
            .filter(|(p, modified)| before.get(p).is_none_or(|prev| modified > prev))
            .max_by_key(|(_, modified)| *modified)
            .map(|(p, _)| p)
        else {
            return Ok(None);
        };

        let stem = source_path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("topaz");
        let output_path = unique_output_path(&dir, stem);
        fs::rename(&topaz_output, &output_path)
            .map_err(|e| format!("Failed to rename Topaz output: {}", e))?;

        let _ = crate::exif_processing::write_rrexif_sidecar(
            &source_path.to_string_lossy(),
            &output_path,
        );

        let output_path_str = output_path.to_string_lossy().to_string();
        if source_sidecar.exists() {
            let (_, dest_sidecar) = parse_virtual_path(&output_path_str);
            let drop_crop = was_resized(&source_path, &output_path);
            if let Err(e) = copy_sidecar(&source_sidecar, &dest_sidecar, drop_crop) {
                log::warn!("Failed to copy sidecar file for Topaz output: {}", e);
            }
        }

        Ok(Some(output_path_str))
    })
    .await
    .map_err(|e| format!("Topaz task failed: {}", e))?
}
