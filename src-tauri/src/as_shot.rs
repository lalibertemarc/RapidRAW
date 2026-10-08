use crate::file_management::{parse_virtual_path, read_file_mapped};
use crate::formats::is_raw_file;
use crate::white_balance::WhiteBalance;
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Mutex, OnceLock};

#[derive(Clone, Copy, Debug)]
pub struct AsShot {
    pub white_balance: WhiteBalance,
    pub baseline_exposure: f32,
}

impl AsShot {
    pub fn reference() -> Self {
        Self {
            white_balance: WhiteBalance::reference(),
            baseline_exposure: 0.0,
        }
    }
}

#[derive(Clone, Copy)]
struct CachedAsShot {
    as_shot: AsShot,
    baseline_measured: bool,
}

fn as_shot_cache() -> &'static Mutex<HashMap<String, CachedAsShot>> {
    static CACHE: OnceLock<Mutex<HashMap<String, CachedAsShot>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn raw_source_path(path: &str) -> Option<String> {
    let (source_path, _) = parse_virtual_path(path);
    let source_path = source_path.to_string_lossy().to_string();
    is_raw_file(&source_path).then_some(source_path)
}

fn cached_as_shot(source_path: &str) -> CachedAsShot {
    if let Some(cached) = as_shot_cache().lock().unwrap().get(source_path) {
        return *cached;
    }

    let as_shot = read_file_mapped(Path::new(source_path))
        .ok()
        .and_then(|mmap| crate::raw_processing::read_as_shot(&mmap))
        .unwrap_or_else(AsShot::reference);

    *as_shot_cache()
        .lock()
        .unwrap()
        .entry(source_path.to_string())
        .or_insert(CachedAsShot {
            as_shot,
            baseline_measured: false,
        })
}

pub fn as_shot(path: &str) -> AsShot {
    raw_source_path(path).map_or_else(AsShot::reference, |source_path| {
        cached_as_shot(&source_path).as_shot
    })
}

pub fn needs_measured_baseline(path: &str) -> bool {
    raw_source_path(path).is_some_and(|source_path| {
        !as_shot_cache()
            .lock()
            .unwrap()
            .get(&source_path)
            .is_some_and(|cached| cached.baseline_measured)
    })
}

pub fn record_measured_baseline(path: &str, measured: Option<f32>) {
    let Some(source_path) = raw_source_path(path) else {
        return;
    };
    let mut cached = cached_as_shot(&source_path);
    match measured {
        Some(baseline_exposure) => {
            cached.as_shot.baseline_exposure = baseline_exposure;
            log::info!(
                "Baseline exposure measured for '{}': {:+.2} EV from the camera JPEG",
                source_path,
                baseline_exposure
            );
        }
        None => log::info!(
            "Baseline exposure for '{}': no usable camera JPEG, using the {:+.2} EV fallback",
            source_path,
            cached.as_shot.baseline_exposure
        ),
    }
    cached.baseline_measured = true;
    as_shot_cache().lock().unwrap().insert(source_path, cached);
}
