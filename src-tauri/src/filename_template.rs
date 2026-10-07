use std::cell::OnceCell;
use std::collections::HashMap;
use std::path::Path;

use chrono::{DateTime, Local, Utc};
use regex::regex;
use serde::{Deserialize, Serialize};

use crate::exif_processing;
use crate::file_management::{parse_virtual_path, read_file_mapped};
use crate::image_processing::{ImageFlag, ImageMetadata};
use crate::tagging::COLOR_TAG_PREFIX;

#[derive(Serialize, Deserialize, Debug, Clone, Copy, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FilenameCase {
    #[default]
    AsIs,
    Lower,
    Upper,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct FilenameSettings {
    #[serde(default)]
    pub filename_template: Option<String>,
    #[serde(default)]
    pub sequence_start: Option<usize>,
    #[serde(default)]
    pub custom_text: Option<String>,
    #[serde(default)]
    pub filename_case: FilenameCase,
    #[serde(default)]
    pub preset_name: Option<String>,
}

impl FilenameSettings {
    pub fn export_stem(
        &self,
        source_path: &Path,
        sidecar_path: &Path,
        index: usize,
        total: usize,
        now: DateTime<Local>,
    ) -> String {
        let capture_date = exif_processing::get_creation_date_from_path(source_path);
        let mut context = FilenameContext::new(source_path, index, total, &capture_date);
        context.sidecar_path = Some(sidecar_path);
        context.sequence_start = self.sequence_start.unwrap_or(1);
        context.now = now;
        context.custom_text = self.custom_text.as_deref().unwrap_or_default();
        context.preset_name = self.preset_name.as_deref().unwrap_or_default();
        context.case = self.filename_case;
        let template = self
            .filename_template
            .as_deref()
            .unwrap_or("{original_filename}_edited");
        generate_filename_from_template(template, &context)
    }
}

#[tauri::command]
pub async fn preview_export_filename(
    path: String,
    index: usize,
    total: usize,
    naming: FilenameSettings,
) -> String {
    let (source_path, sidecar_path) = parse_virtual_path(&path);
    naming.export_stem(&source_path, &sidecar_path, index, total, Local::now())
}

pub struct FilenameContext<'a> {
    pub original_path: &'a Path,
    pub sidecar_path: Option<&'a Path>,
    pub index: usize,
    pub total: usize,
    pub sequence_start: usize,
    pub capture_date: &'a DateTime<Utc>,
    pub now: DateTime<Local>,
    pub custom_text: &'a str,
    pub preset_name: &'a str,
    pub case: FilenameCase,
}

impl<'a> FilenameContext<'a> {
    pub fn new(
        original_path: &'a Path,
        index: usize,
        total: usize,
        capture_date: &'a DateTime<Utc>,
    ) -> Self {
        Self {
            original_path,
            sidecar_path: None,
            index,
            total,
            sequence_start: 1,
            capture_date,
            now: Local::now(),
            custom_text: "",
            preset_name: "",
            case: FilenameCase::AsIs,
        }
    }
}

struct Resolver<'a> {
    ctx: &'a FilenameContext<'a>,
    capture: DateTime<Local>,
    metadata: OnceCell<ImageMetadata>,
    exif: OnceCell<HashMap<String, String>>,
}

impl Resolver<'_> {
    fn metadata(&self) -> &ImageMetadata {
        self.metadata.get_or_init(|| {
            self.ctx
                .sidecar_path
                .map(exif_processing::load_sidecar)
                .unwrap_or_default()
        })
    }

    fn exif(&self) -> &HashMap<String, String> {
        self.exif.get_or_init(|| {
            if let Some(exif) = &self.metadata().exif {
                return exif.clone();
            }
            if let Some(exif) = exif_processing::read_rrexif_sidecar(self.ctx.original_path) {
                return exif;
            }
            read_file_mapped(self.ctx.original_path)
                .map(|mmap| {
                    exif_processing::read_exif_data_from_bytes(
                        &self.ctx.original_path.to_string_lossy(),
                        &mmap,
                    )
                })
                .unwrap_or_default()
        })
    }

    fn exif_value(&self, keys: &[&str]) -> String {
        keys.iter()
            .filter_map(|key| self.exif().get(*key))
            .map(|value| value.trim())
            .find(|value| !value.is_empty())
            .unwrap_or_default()
            .to_string()
    }

    fn model(&self) -> String {
        let model = self.exif_value(&["Model"]);
        let make = self.exif_value(&["Make"]);
        let Some(brand) = make.split_whitespace().next() else {
            return model;
        };
        match model.get(..brand.len()) {
            Some(prefix) if prefix.eq_ignore_ascii_case(brand) => {
                let rest = model[brand.len()..].trim();
                if rest.is_empty() {
                    model
                } else {
                    rest.to_string()
                }
            }
            _ => model,
        }
    }

    fn sequence(&self, width: Option<usize>) -> String {
        let sequence = self.ctx.sequence_start + self.ctx.index;
        let width = width.unwrap_or_else(|| {
            (self.ctx.sequence_start + self.ctx.total.max(1) - 1)
                .to_string()
                .len()
        });
        format!("{:0width$}", sequence, width = width)
    }

    fn resolve(&self, token: &str, arg: Option<usize>) -> Option<String> {
        let capture = &self.capture;
        let now = &self.ctx.now;
        let value = match (token, arg) {
            ("sequence", width) => self.sequence(width),
            (_, Some(_)) => return None,
            ("original_filename", _) => file_stem(self.ctx.original_path),
            ("original_ext", _) => self
                .ctx
                .original_path
                .extension()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_default(),
            ("folder", _) => self
                .ctx
                .original_path
                .parent()
                .and_then(|p| p.file_name())
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_default(),
            ("total", _) => self.ctx.total.to_string(),
            ("YYYY", _) => capture.format("%Y").to_string(),
            ("YY", _) => capture.format("%y").to_string(),
            ("MM", _) => capture.format("%m").to_string(),
            ("Month", _) => capture.format("%B").to_string(),
            ("Mon", _) => capture.format("%b").to_string(),
            ("DD", _) => capture.format("%d").to_string(),
            ("hh", _) => capture.format("%H").to_string(),
            ("mm", _) => capture.format("%M").to_string(),
            ("ss", _) => capture.format("%S").to_string(),
            ("date", _) => capture.format("%Y-%m-%d").to_string(),
            ("time", _) => capture.format("%H%M%S").to_string(),
            ("subsec", _) => self.exif_value(&["SubSecTimeOriginal", "SubSecTime"]),
            ("export_date", _) => now.format("%Y-%m-%d").to_string(),
            ("export_time", _) => now.format("%H%M%S").to_string(),
            ("make", _) => self.exif_value(&["Make"]),
            ("model", _) => self.model(),
            ("lens", _) => self.exif_value(&["LensModel"]),
            ("iso", _) => {
                self.exif_value(&["PhotographicSensitivity", "ISOSpeed", "ISOSpeedRatings"])
            }
            ("focal", _) => {
                let focal = self.exif_value(&["FocalLength"]);
                let focal = focal.trim_end_matches("mm").trim();
                if focal.is_empty() {
                    String::new()
                } else {
                    format!("{}mm", focal)
                }
            }
            ("aperture", _) => {
                let aperture = self.exif_value(&["FNumber"]);
                let aperture = aperture.trim_start_matches("f/").trim();
                if aperture.is_empty() {
                    String::new()
                } else {
                    format!("f{}", aperture)
                }
            }
            ("shutter", _) => self.exif_value(&["ExposureTime"]).replace(' ', ""),
            ("serial", _) => self.exif_value(&["SerialNumber", "BodySerialNumber"]),
            ("title", _) => self.exif_value(&["ImageDescription"]),
            ("author", _) => self.exif_value(&["Artist"]),
            ("copyright", _) => self.exif_value(&["Copyright"]),
            ("comments", _) => {
                let comments = self.exif_value(&["UserComment"]);
                if comments.starts_with("0x") {
                    String::new()
                } else {
                    comments
                }
            }
            ("rating", _) => self.metadata().rating.to_string(),
            ("label", _) => self
                .metadata()
                .tags
                .iter()
                .flatten()
                .find_map(|tag| tag.strip_prefix(COLOR_TAG_PREFIX))
                .unwrap_or_default()
                .to_string(),
            ("flag", _) => match self.metadata().flag {
                Some(ImageFlag::Pick) => "pick".to_string(),
                Some(ImageFlag::Reject) => "reject".to_string(),
                None => String::new(),
            },
            ("text", _) => self.ctx.custom_text.to_string(),
            ("preset", _) => self.ctx.preset_name.to_string(),
            _ => return None,
        };
        Some(sanitize_component(&value))
    }
}

fn file_stem(path: &Path) -> String {
    path.file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "image".to_string())
}

fn sanitize_component(value: &str) -> String {
    value
        .chars()
        .map(|c| match c {
            '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '-',
            c if c.is_control() => '-',
            c => c,
        })
        .collect::<String>()
        .trim()
        .to_string()
}

pub fn generate_filename_from_template(template: &str, ctx: &FilenameContext) -> String {
    let resolver = Resolver {
        ctx,
        capture: ctx.capture_date.with_timezone(&Local),
        metadata: OnceCell::new(),
        exif: OnceCell::new(),
    };

    let resolved =
        regex!(r"\{([A-Za-z_]+)(?::(\d+))?\}").replace_all(template, |caps: &regex::Captures| {
            let arg = caps.get(2).and_then(|m| m.as_str().parse().ok());
            resolver
                .resolve(&caps[1], arg)
                .unwrap_or_else(|| caps[0].to_string())
        });

    let cased = match ctx.case {
        FilenameCase::AsIs => resolved.into_owned(),
        FilenameCase::Lower => resolved.to_lowercase(),
        FilenameCase::Upper => resolved.to_uppercase(),
    };

    let trimmed = cased.trim().trim_end_matches(['.', ' ']);
    if trimmed.is_empty() {
        file_stem(ctx.original_path)
    } else {
        trimmed.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn context<'a>(path: &'a Path, date: &'a DateTime<Utc>) -> FilenameContext<'a> {
        let mut ctx = FilenameContext::new(path, 0, 1, date);
        ctx.now = Local.with_ymd_and_hms(2026, 10, 7, 9, 5, 3).unwrap();
        ctx
    }

    fn resolver<'a>(ctx: &'a FilenameContext<'a>, exif: &[(&str, &str)]) -> Resolver<'a> {
        let resolver = Resolver {
            ctx,
            capture: ctx.capture_date.with_timezone(&Local),
            metadata: OnceCell::new(),
            exif: OnceCell::new(),
        };
        let _ = resolver.metadata.set(ImageMetadata {
            rating: 4,
            flag: Some(ImageFlag::Pick),
            tags: Some(vec!["landscape".into(), format!("{}red", COLOR_TAG_PREFIX)]),
            ..Default::default()
        });
        let _ = resolver.exif.set(
            exif.iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
        );
        resolver
    }

    fn local_date() -> DateTime<Utc> {
        Local
            .with_ymd_and_hms(2024, 3, 9, 14, 7, 42)
            .unwrap()
            .with_timezone(&Utc)
    }

    #[test]
    fn keeps_existing_tokens() {
        let path = Path::new("/photos/trip/IMG_0042.CR3");
        let date = local_date();
        let ctx = context(path, &date);
        assert_eq!(
            generate_filename_from_template("{original_filename}_edited", &ctx),
            "IMG_0042_edited"
        );
        assert_eq!(
            generate_filename_from_template("{YYYY}{MM}{DD}-{hh}{mm}_{sequence}", &ctx),
            "20240309-1407_1"
        );
    }

    #[test]
    fn resolves_file_and_date_tokens() {
        let path = Path::new("/photos/trip/IMG_0042.CR3");
        let date = local_date();
        let ctx = context(path, &date);
        assert_eq!(
            generate_filename_from_template(
                "{folder}_{original_ext}_{YY}_{Month}_{Mon}_{ss}_{date}_{time}",
                &ctx
            ),
            "trip_CR3_24_March_Mar_42_2024-03-09_140742"
        );
        assert_eq!(
            generate_filename_from_template("{export_date}_{export_time}", &ctx),
            "2026-10-07_090503"
        );
    }

    #[test]
    fn pads_sequence() {
        let path = Path::new("/photos/a.jpg");
        let date = local_date();
        let mut ctx = context(path, &date);
        ctx.index = 4;
        ctx.total = 120;
        assert_eq!(generate_filename_from_template("{sequence}", &ctx), "005");
        assert_eq!(
            generate_filename_from_template("{sequence:5}", &ctx),
            "00005"
        );
        assert_eq!(generate_filename_from_template("{sequence:1}", &ctx), "5");
        assert_eq!(generate_filename_from_template("{total}", &ctx), "120");
        ctx.sequence_start = 950;
        ctx.total = 60;
        assert_eq!(generate_filename_from_template("{sequence}", &ctx), "0954");
    }

    #[test]
    fn resolves_exif_tokens() {
        let path = Path::new("/photos/DSC_0001.NEF");
        let date = local_date();
        let ctx = context(path, &date);
        let r = resolver(
            &ctx,
            &[
                ("Make", "NIKON CORPORATION"),
                ("Model", "NIKON D810"),
                ("LensModel", "24.0-120.0 mm f/4.0"),
                ("ISOSpeed", "400"),
                ("FocalLength", "50 mm"),
                ("FNumber", "f/2.8"),
                ("ExposureTime", "1/250 s"),
                ("BodySerialNumber", "6012345"),
                ("SubSecTimeOriginal", "37"),
            ],
        );
        let get = |token| r.resolve(token, None).unwrap();
        assert_eq!(get("make"), "NIKON CORPORATION");
        assert_eq!(get("model"), "D810");
        assert_eq!(get("lens"), "24.0-120.0 mm f-4.0");
        assert_eq!(get("iso"), "400");
        assert_eq!(get("focal"), "50mm");
        assert_eq!(get("aperture"), "f2.8");
        assert_eq!(get("shutter"), "1-250s");
        assert_eq!(get("serial"), "6012345");
        assert_eq!(get("subsec"), "37");
    }

    #[test]
    fn strips_make_from_model_only_when_prefixed() {
        let path = Path::new("/photos/a.ARW");
        let date = local_date();
        let ctx = context(path, &date);
        let r = resolver(&ctx, &[("Make", "Canon"), ("Model", "Canon EOS R5")]);
        assert_eq!(r.resolve("model", None).unwrap(), "EOS R5");
        let r = resolver(&ctx, &[("Make", "SONY"), ("Model", "ILCE-7M3")]);
        assert_eq!(r.resolve("model", None).unwrap(), "ILCE-7M3");
        let r = resolver(&ctx, &[("Make", "Leica"), ("Model", "LEICA")]);
        assert_eq!(r.resolve("model", None).unwrap(), "LEICA");
    }

    #[test]
    fn resolves_metadata_tokens() {
        let path = Path::new("/photos/a.jpg");
        let date = local_date();
        let ctx = context(path, &date);
        let r = resolver(
            &ctx,
            &[
                ("ImageDescription", "Sunset: Bay"),
                ("Artist", "Jane Doe"),
                ("Copyright", "(c) 2024"),
                ("UserComment", "0x41534349490000"),
                ("FocalLength", "35"),
            ],
        );
        let get = |token| r.resolve(token, None).unwrap();
        assert_eq!(get("title"), "Sunset- Bay");
        assert_eq!(get("author"), "Jane Doe");
        assert_eq!(get("copyright"), "(c) 2024");
        assert_eq!(get("comments"), "");
        assert_eq!(get("rating"), "4");
        assert_eq!(get("label"), "red");
        assert_eq!(get("flag"), "pick");
        assert_eq!(get("focal"), "35mm");
        assert_eq!(get("lens"), "");
    }

    #[test]
    fn custom_text_case_and_fallbacks() {
        let path = Path::new("/photos/IMG_1.jpg");
        let date = local_date();
        let mut ctx = context(path, &date);
        ctx.custom_text = "Wedding/Smith";
        ctx.preset_name = "Web";
        assert_eq!(
            generate_filename_from_template("{text}_{preset}_{unknown}_{YYYY:2}", &ctx),
            "Wedding-Smith_Web_{unknown}_{YYYY:2}"
        );
        ctx.case = FilenameCase::Lower;
        assert_eq!(
            generate_filename_from_template("{text}", &ctx),
            "wedding-smith"
        );
        ctx.case = FilenameCase::Upper;
        assert_eq!(
            generate_filename_from_template("{original_filename}", &ctx),
            "IMG_1"
        );
        ctx.case = FilenameCase::AsIs;
        ctx.custom_text = "";
        assert_eq!(generate_filename_from_template("{text}", &ctx), "IMG_1");
        assert_eq!(generate_filename_from_template("name. ", &ctx), "name");
    }
}
