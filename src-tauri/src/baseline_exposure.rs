use rawler::bits::Endian;
use rawler::decoders::{Decoder, FormatHint, WellKnownIFD};
use rawler::formats::bmff::Bmff;
use rawler::formats::tiff::reader::TiffReader;
use rawler::formats::tiff::{IFD, Value, ifd::OffsetMode};
use rawler::tags::{DngTag, ExifTag};
use std::io::Cursor;
use std::panic::{AssertUnwindSafe, catch_unwind};

const SCENE_REFERRED_BASELINE: f32 = 0.7;
const HIGHLIGHT_BIAS_MIN: f32 = -1.0;
const HIGHLIGHT_BIAS_MAX: f32 = 4.0;

const CANON_LIGHTING_OPT: u16 = 0x4018;
const FUJI_DEVELOPMENT_DYNAMIC_RANGE: u16 = 0x1403;
const FUJI_AUTO_DYNAMIC_RANGE: u16 = 0x140b;
const NIKON_COLOR_SPACE: u16 = 0x001e;
const NIKON_ACTIVE_D_LIGHTING: u16 = 0x0022;
const OLYMPUS_CAMERA_SETTINGS: u16 = 0x2020;
const OLYMPUS_GRADATION: u16 = 0x050f;
const PENTAX_DYNAMIC_RANGE_EXPANSION: u16 = 0x0069;

const RAF_JPEG_OFFSET_POSITION: usize = 84;
const RAF_JPEG_TIFF_HEADER: u32 = 12;
const FUJI_MAKERNOTE_HEADER: &[u8] = b"FUJIFILM";
const FUJI_MAKERNOTE_IFD_OFFSET: u32 = 12;

pub fn read(decoder: &dyn Decoder, file_bytes: &[u8], is_monochrome: bool) -> f32 {
    let highlight = catch_unwind(AssertUnwindSafe(|| {
        highlight_preservation(decoder.format_hint(), file_bytes)
    }))
    .unwrap_or(0.0);
    total(is_monochrome, highlight, dng_baseline(decoder))
}

fn total(is_monochrome: bool, highlight_preservation: f32, dng_baseline: f32) -> f32 {
    let scene_referred = if is_monochrome {
        0.0
    } else {
        SCENE_REFERRED_BASELINE
    };
    scene_referred
        + highlight_preservation.clamp(HIGHLIGHT_BIAS_MIN, HIGHLIGHT_BIAS_MAX)
        + dng_baseline
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

fn highlight_preservation(format: FormatHint, file_bytes: &[u8]) -> f32 {
    match format {
        FormatHint::CR2 => tiff_makernote(file_bytes).map(|makernote| canon(&makernote)),
        FormatHint::CR3 => Bmff::new_buf(file_bytes)
            .ok()
            .and_then(|bmff| bmff.filebox.moov.cr3desc)
            .map(|desc| canon(desc.cmt3.tiff.root_ifd())),
        FormatHint::NEF | FormatHint::NRW => {
            tiff_makernote(file_bytes).map(|makernote| nikon(&makernote))
        }
        FormatHint::PEF => tiff_makernote(file_bytes).map(|makernote| pentax(&makernote)),
        FormatHint::ORF => olympus_camera_settings(file_bytes).map(|settings| olympus(&settings)),
        FormatHint::RAF => fuji_makernote(file_bytes).map(|makernote| fuji(&makernote)),
        _ => None,
    }
    .unwrap_or(0.0)
}

fn exif_with_makernote(cursor: &mut Cursor<&[u8]>, tiff_offset: u32) -> Option<IFD> {
    IFD::new_root(cursor, tiff_offset)
        .ok()?
        .find_first_ifd_with_tag(ExifTag::MakerNotes)
        .cloned()
}

fn makernote_start(exif: &IFD) -> Option<u32> {
    Some(exif.base + exif.get_entry(ExifTag::MakerNotes)?.offset()? as u32)
}

fn tiff_makernote(file_bytes: &[u8]) -> Option<IFD> {
    let mut cursor = Cursor::new(file_bytes);
    exif_with_makernote(&mut cursor, 0)?
        .parse_makernote(&mut cursor, OffsetMode::Absolute, &[])
        .ok()?
}

fn fuji_makernote(file_bytes: &[u8]) -> Option<IFD> {
    let jpeg_offset = u32::from_be_bytes(
        file_bytes
            .get(RAF_JPEG_OFFSET_POSITION..RAF_JPEG_OFFSET_POSITION + 4)?
            .try_into()
            .ok()?,
    );
    let mut cursor = Cursor::new(file_bytes);
    let exif = exif_with_makernote(&mut cursor, jpeg_offset + RAF_JPEG_TIFF_HEADER)?;
    if !matches!(
        exif.get_entry(ExifTag::MakerNotes).map(|entry| &entry.value),
        Some(Value::Undefined(data)) if data.starts_with(FUJI_MAKERNOTE_HEADER)
    ) {
        return None;
    }
    IFD::new(
        &mut cursor,
        FUJI_MAKERNOTE_IFD_OFFSET,
        makernote_start(&exif)?,
        0,
        Endian::Little,
        &[],
    )
    .ok()
}

fn olympus_camera_settings(file_bytes: &[u8]) -> Option<IFD> {
    let mut cursor = Cursor::new(file_bytes);
    let exif = exif_with_makernote(&mut cursor, 0)?;
    let makernote = rawler::decoders::orf::parse_makernote(&mut cursor, &exif).ok()??;
    let settings_offset = makernote
        .get_entry_raw_with_len(OLYMPUS_CAMERA_SETTINGS, &mut cursor, 4)
        .ok()??
        .get_force_u32(0);
    IFD::new(
        &mut cursor,
        settings_offset,
        makernote_start(&exif)?,
        0,
        makernote.endian,
        &[],
    )
    .ok()
}

fn integers(ifd: &IFD, tag: u16) -> Vec<i32> {
    ifd.get_entry(tag)
        .map(|entry| {
            (0..entry.value.count())
                .map_while(|index| entry.value.get_i32(index).ok().flatten())
                .collect()
        })
        .unwrap_or_default()
}

fn first_integer(ifd: &IFD, tag: u16) -> Option<i32> {
    ifd.get_entry(tag)?.value.get_i32(0).ok().flatten()
}

fn canon(makernote: &IFD) -> f32 {
    canon_bias(&integers(makernote, CANON_LIGHTING_OPT))
}

fn canon_bias(lighting_opt: &[i32]) -> f32 {
    let auto_lighting_optimizer = match lighting_opt.get(2) {
        Some(0) => 0.5,
        Some(1) => 0.33,
        Some(2) => 0.66,
        _ => 0.0,
    };
    let highlight_tone_priority = match lighting_opt.get(3) {
        Some(&state) if state > 0 => 1.0,
        _ => 0.0,
    };
    auto_lighting_optimizer + highlight_tone_priority
}

fn fuji(makernote: &IFD) -> f32 {
    [FUJI_DEVELOPMENT_DYNAMIC_RANGE, FUJI_AUTO_DYNAMIC_RANGE]
        .into_iter()
        .find_map(|tag| first_integer(makernote, tag))
        .map_or(0.0, fuji_bias)
}

fn fuji_bias(dynamic_range: i32) -> f32 {
    match dynamic_range {
        200 => 1.0,
        400 => 2.0,
        _ => 0.0,
    }
}

fn nikon(makernote: &IFD) -> f32 {
    nikon_bias(
        first_integer(makernote, NIKON_COLOR_SPACE),
        first_integer(makernote, NIKON_ACTIVE_D_LIGHTING),
    )
}

fn nikon_bias(color_space: Option<i32>, active_d_lighting: Option<i32>) -> f32 {
    if color_space == Some(4) {
        return 2.0;
    }
    match active_d_lighting {
        Some(3) => 0.33,
        Some(5) => 0.66,
        Some(7) => 1.0,
        Some(8) => 1.1,
        Some(9) => 1.2,
        Some(10) => 1.3,
        Some(11) => 1.33,
        _ => 0.0,
    }
}

fn olympus(camera_settings: &IFD) -> f32 {
    olympus_bias(&integers(camera_settings, OLYMPUS_GRADATION))
}

fn olympus_bias(gradation: &[i32]) -> f32 {
    match gradation {
        [_, _, _, 1, ..] => 0.33,
        [-1, -1, 1, ..] => 0.66,
        _ => 0.0,
    }
}

fn pentax(makernote: &IFD) -> f32 {
    match makernote
        .get_entry(PENTAX_DYNAMIC_RANGE_EXPANSION)
        .map(|entry| &entry.value)
    {
        Some(Value::Undefined(data)) => pentax_bias(data),
        _ => 0.0,
    }
}

fn pentax_bias(dynamic_range_expansion: &[u8]) -> f32 {
    match dynamic_range_expansion {
        [1, ..] => 1.0,
        _ => 0.0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn total_adds_components_and_clamps_highlight_bias() {
        assert_eq!(total(false, 0.0, 0.0), SCENE_REFERRED_BASELINE);
        assert_eq!(total(true, 0.0, 0.0), 0.0);
        assert_eq!(total(false, 1.0, 0.5), SCENE_REFERRED_BASELINE + 1.5);
        assert_eq!(total(true, 9.0, 0.0), HIGHLIGHT_BIAS_MAX);
        assert_eq!(total(true, -9.0, 0.0), HIGHLIGHT_BIAS_MIN);
    }

    #[test]
    fn canon_reads_auto_lighting_optimizer_and_highlight_tone_priority() {
        assert_eq!(canon_bias(&[]), 0.0);
        assert_eq!(canon_bias(&[44, 0, 0, 0]), 0.5);
        assert_eq!(canon_bias(&[44, 0, 1, 0]), 0.33);
        assert_eq!(canon_bias(&[44, 0, 2, 0]), 0.66);
        assert_eq!(canon_bias(&[44, 0, 3, 0]), 0.0);
        assert_eq!(canon_bias(&[44, 0, 3, 1]), 1.0);
        assert_eq!(canon_bias(&[44, 0, 3, 2]), 1.0);
        assert_eq!(canon_bias(&[44, 0, 0, 1]), 1.5);
    }

    #[test]
    fn fuji_maps_dynamic_range_to_stops() {
        assert_eq!(fuji_bias(100), 0.0);
        assert_eq!(fuji_bias(200), 1.0);
        assert_eq!(fuji_bias(400), 2.0);
    }

    #[test]
    fn nikon_prefers_hlg_then_active_d_lighting() {
        assert_eq!(nikon_bias(Some(4), Some(7)), 2.0);
        assert_eq!(nikon_bias(Some(1), None), 0.0);
        assert_eq!(nikon_bias(Some(1), Some(1)), 0.0);
        assert_eq!(nikon_bias(Some(1), Some(3)), 0.33);
        assert_eq!(nikon_bias(Some(2), Some(7)), 1.0);
        assert_eq!(nikon_bias(None, Some(11)), 1.33);
        assert_eq!(nikon_bias(Some(1), Some(0xffff)), 0.0);
    }

    #[test]
    fn olympus_reads_gradation() {
        assert_eq!(olympus_bias(&[]), 0.0);
        assert_eq!(olympus_bias(&[0, 0, 0]), 0.0);
        assert_eq!(olympus_bias(&[-1, -1, 1]), 0.66);
        assert_eq!(olympus_bias(&[-1, -1, 1, 0]), 0.66);
        assert_eq!(olympus_bias(&[-1, -1, 1, 1]), 0.33);
        assert_eq!(olympus_bias(&[1, -1, 1]), 0.0);
    }

    #[test]
    fn pentax_reads_dynamic_range_expansion() {
        assert_eq!(pentax_bias(&[]), 0.0);
        assert_eq!(pentax_bias(&[0, 0, 0, 0]), 0.0);
        assert_eq!(pentax_bias(&[1, 1, 0, 0]), 1.0);
    }
}
