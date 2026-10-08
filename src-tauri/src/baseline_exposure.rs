use crate::image_loader::srgb_to_linear_lut;
use image::{DynamicImage, Pixel};
use rawler::decoders::{Decoder, WellKnownIFD};
use rawler::tags::DngTag;
use rayon::prelude::*;

const SCENE_REFERRED_BASELINE: f32 = 0.7;
const BASIC_TONEMAPPER_MID_GREY_GAIN: f32 = 0.16;
const MEASURED_BASELINE_MIN: f32 = -1.0;
const MEASURED_BASELINE_MAX: f32 = 4.0;

const GRID_WIDTH: u32 = 240;
const GRID_HEIGHT: u32 = 160;
const SAMPLES_PER_CELL_AXIS: u32 = 4;
const MIN_PREVIEW_WIDTH: u32 = GRID_WIDTH * 2;
const MAX_ASPECT_RATIO_MISMATCH: f32 = 0.02;
const MID_GREY_LOW: f32 = 0.10;
const MID_GREY_HIGH: f32 = 0.30;
const MIN_RAW_LUMINANCE: f32 = 1.0e-4;
const MIN_MID_GREY_CELLS: usize = 500;

pub struct CameraRendering {
    luminance: Vec<f32>,
    aspect_ratio: f32,
}

pub fn fallback(decoder: &dyn Decoder, is_monochrome: bool) -> f32 {
    let scene_referred = if is_monochrome {
        0.0
    } else {
        SCENE_REFERRED_BASELINE
    };
    scene_referred + dng_baseline(decoder)
}

fn dng_baseline(decoder: &dyn Decoder) -> f32 {
    let Ok(Some(tags)) = decoder.ifd(WellKnownIFD::VirtualDngRootTags) else {
        return 0.0;
    };
    [DngTag::BaselineExposure, DngTag::BaselineExposureOffset]
        .into_iter()
        .filter_map(|tag| tags.get_entry(tag)?.value.get_f32(0).ok().flatten())
        .sum()
}

pub fn camera_rendering(preview: DynamicImage) -> Option<CameraRendering> {
    let preview = preview.into_rgb8();
    if preview.width() < MIN_PREVIEW_WIDTH {
        return None;
    }
    let to_linear = srgb_to_linear_lut();
    Some(CameraRendering {
        luminance: luminance_grid(preview.width(), preview.height(), |x, y| {
            luminance(preview.get_pixel(x, y).0.map(|c| to_linear[usize::from(c)]))
        }),
        aspect_ratio: aspect_ratio(preview.width(), preview.height()),
    })
}

pub fn measure(camera: &CameraRendering, developed: &DynamicImage) -> Option<f32> {
    let (width, height) = (developed.width(), developed.height());
    if (aspect_ratio(width, height) / camera.aspect_ratio - 1.0).abs() > MAX_ASPECT_RATIO_MISMATCH {
        return None;
    }
    let rendered = match developed {
        DynamicImage::ImageRgba32F(img) => luminance_grid(width, height, |x, y| {
            luminance(img.get_pixel(x, y).to_rgb().0)
        }),
        DynamicImage::ImageRgb32F(img) => {
            luminance_grid(width, height, |x, y| luminance(img.get_pixel(x, y).0))
        }
        _ => return None,
    };

    let mut gains: Vec<f32> = camera
        .luminance
        .iter()
        .zip(&rendered)
        .filter(|&(&camera, &raw)| {
            (MID_GREY_LOW..MID_GREY_HIGH).contains(&camera) && raw > MIN_RAW_LUMINANCE
        })
        .map(|(camera, raw)| (camera / raw).log2())
        .collect();
    if gains.len() < MIN_MID_GREY_CELLS {
        return None;
    }
    let middle = gains.len() / 2;
    let (_, median, _) = gains.select_nth_unstable_by(middle, f32::total_cmp);
    Some(
        (*median - BASIC_TONEMAPPER_MID_GREY_GAIN)
            .clamp(MEASURED_BASELINE_MIN, MEASURED_BASELINE_MAX),
    )
}

fn aspect_ratio(width: u32, height: u32) -> f32 {
    width as f32 / height as f32
}

fn luminance([r, g, b]: [f32; 3]) -> f32 {
    0.2126 * r + 0.7152 * g + 0.0722 * b
}

fn luminance_grid(
    width: u32,
    height: u32,
    luminance_at: impl Fn(u32, u32) -> f32 + Sync,
) -> Vec<f32> {
    let samples = SAMPLES_PER_CELL_AXIS * SAMPLES_PER_CELL_AXIS;
    (0..GRID_WIDTH * GRID_HEIGHT)
        .into_par_iter()
        .map(|cell| {
            let (cell_x, cell_y) = (cell % GRID_WIDTH, cell / GRID_WIDTH);
            let sum: f32 = (0..samples)
                .map(|sample| {
                    let x = (cell_x * SAMPLES_PER_CELL_AXIS + sample % SAMPLES_PER_CELL_AXIS)
                        * width
                        / (GRID_WIDTH * SAMPLES_PER_CELL_AXIS);
                    let y = (cell_y * SAMPLES_PER_CELL_AXIS + sample / SAMPLES_PER_CELL_AXIS)
                        * height
                        / (GRID_HEIGHT * SAMPLES_PER_CELL_AXIS);
                    luminance_at(x, y)
                })
                .sum();
            sum / samples as f32
        })
        .collect()
}
