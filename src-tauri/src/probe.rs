use crate::decode::formats::is_raw_file;
use crate::metadata::exif_processing::{read_exif_data_from_bytes, read_raw_metadata};
use rawler::decoders::{RawDecodeParams, RawMetadata};
use rawler::rawsource::RawSource;
use serde_json::{Value, json};
use std::collections::BTreeMap;

pub fn run(args: &[String]) -> i32 {
    let result = match args {
        [command, path] if command == "meta" => meta(path),
        _ => Err("Usage: RapidRAW probe meta <image>".to_string()),
    };
    match result {
        Ok(value) => {
            cli_println!(
                "{}",
                serde_json::to_string_pretty(&value).unwrap_or_default()
            );
            0
        }
        Err(e) => {
            cli_eprintln!("{}", e);
            1
        }
    }
}

fn meta(path: &str) -> Result<Value, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("Failed to read {}: {}", path, e))?;
    let is_raw = is_raw_file(path);
    let exif: BTreeMap<String, String> = read_exif_data_from_bytes(path, &bytes)
        .into_iter()
        .collect();

    Ok(json!({
        "path": path,
        "bytes": bytes.len(),
        "isRaw": is_raw,
        "decoder": is_raw.then(|| decoder_info(&bytes).unwrap_or_else(|e| json!({ "error": e }))),
        "asShot": is_raw.then(|| crate::decode::raw_processing::read_as_shot(&bytes)).flatten().map(|as_shot| json!({
            "whiteBalance": as_shot.white_balance,
            "exposure": {
                "sceneReferred": as_shot.exposure.scene_referred,
                "dngBaseline": as_shot.exposure.dng_baseline,
                "highlightPreservation": as_shot.exposure.highlight_preservation,
            },
        })),
        "rawMetadata": is_raw.then(|| read_raw_metadata(&bytes)).flatten().map(raw_metadata_json),
        "exif": exif,
    }))
}

fn raw_metadata_json(mut metadata: RawMetadata) -> Value {
    let unique_image_id = metadata
        .unique_image_id
        .take()
        .map(|id| format!("{:032x}", id));
    let mut value = serde_json::to_value(metadata).unwrap_or_default();
    value["unique_image_id"] = json!(unique_image_id);
    value
}

fn decoder_info(bytes: &[u8]) -> Result<Value, String> {
    let source = RawSource::new_from_slice(bytes);
    let decoder = rawler::get_decoder(&source).map_err(|e| e.to_string())?;
    let raw = decoder
        .raw_image(&source, &RawDecodeParams::default(), true)
        .map_err(|e| e.to_string())?;
    let color_matrix: BTreeMap<String, &Vec<f32>> = raw
        .color_matrix
        .iter()
        .map(|(illuminant, matrix)| (format!("{:?}", illuminant), matrix))
        .collect();
    let dng_tags: BTreeMap<String, String> = raw
        .dng_tags
        .iter()
        .map(|(tag, value)| (format!("0x{:04x}", tag), format!("{:?}", value)))
        .collect();

    Ok(json!({
        "formatHint": format!("{:?}", decoder.format_hint()),
        "make": raw.make,
        "model": raw.model,
        "cleanMake": raw.clean_make,
        "cleanModel": raw.clean_model,
        "width": raw.width,
        "height": raw.height,
        "cpp": raw.cpp,
        "bps": raw.bps,
        "photometric": format!("{:?}", raw.photometric),
        "wbCoeffs": raw.wb_coeffs.map(|c| if c.is_finite() { json!(c) } else { json!(c.to_string()) }),
        "whiteLevel": format!("{:?}", raw.whitelevel),
        "blackLevel": format!("{:?}", raw.blacklevel),
        "activeArea": format!("{:?}", raw.active_area),
        "cropArea": format!("{:?}", raw.crop_area),
        "orientation": format!("{:?}", raw.orientation),
        "colorMatrix": color_matrix,
        "dngTags": dng_tags,
    }))
}
