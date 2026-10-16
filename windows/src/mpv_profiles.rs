//! Встроенные профили mpv: есть всегда, пользовательский mpv.conf может заменить любой одноимённым
//! разделом. Список и значения общие с macOS (`MpvProfiles.swift`): менять оба сразу.
//! Описания профилей лежат в шаблоне mpv.conf (`main.rs`, `mpv_conf_template`).

pub const BUILTIN: &str = r#"[balanced]
scale=ewa_lanczossharp
cscale=ewa_lanczossharp
dscale=mitchell
scale-antiring=0.6
correct-downscaling=yes
linear-downscaling=yes
sigmoid-upscaling=yes
deband=yes
deband-iterations=2
deband-threshold=35
deband-range=20
deband-grain=5

[quality]
scale=ewa_lanczossharp
cscale=ewa_lanczossharp
dscale=ewa_lanczos
scale-antiring=0.6
cscale-antiring=0.6
correct-downscaling=yes
linear-downscaling=yes
sigmoid-upscaling=yes
deband=yes
deband-iterations=4
deband-threshold=40
deband-range=20
deband-grain=8
hdr-compute-peak=yes
tone-mapping=bt.2390

[fast]
scale=bilinear
cscale=bilinear
dscale=bilinear
deband=no
dither-depth=no
correct-downscaling=no
sigmoid-upscaling=no

[hdr-sdr]
tone-mapping=bt.2390
hdr-compute-peak=yes
target-peak=auto
deband=no

[smooth]
video-sync=display-resample
interpolation=yes
tscale=oversample

[anime]
scale=ewa_lanczossharp
cscale=ewa_lanczossharp
sigmoid-upscaling=yes
deband=yes
deband-iterations=3
deband-threshold=48
deband-range=16
deband-grain=0

[night]
af=acompressor=ratio=4,loudnorm=I=-16:TP=-1.5:LRA=11
"#;

/// Описания профилей для шаблона mpv.conf.
pub const DOC_RU: &str = r#"# ── Встроенные профили (выбираются в Настройки → MPV или клавишей P) ──
# Они есть всегда, копировать их в этот файл не нужно. Чтобы изменить встроенный профиль,
# добавьте здесь раздел с тем же именем: он целиком заменит встроенный.
#
# balanced     — фильмы и сериалы: лёгкая подчистка полос (deband), чёткое увеличение, умеренная нагрузка.
# quality      — максимум качества для мощного железа и видео до 1080p: тяжёлое масштабирование,
#                сильный deband, тон-маппинг HDR → SDR. На слабых машинах возможны пропуски кадров.
# fast         — лёгкий: 4K, слабое железо, виртуальная машина. Простое масштабирование, без deband.
# hdr-sdr      — HDR-видео на обычном (SDR) мониторе: тон-маппинг bt.2390 сжимает яркость в диапазон экрана.
# smooth       — плавное движение 24→60 Гц: подгонка кадров под частоту экрана и интерполяция.
#                Нагружает GPU; если кадры пропускаются, вернитесь на balanced.
# anime        — аниме: сильнее подчистка полос без зерна (на плоских заливках зерно заметно).
# night        — ночной режим: сжатие динамического диапазона и выравнивание громкости (тихие диалоги, громкие взрывы).
#
# Яркость, контраст, гамму и насыщенность (например, для тёмного видео) настраивают во время просмотра
# клавишей C: ползунки применяются сразу, запоминаются и не зависят от выбранного профиля.
#
# hdr-compute-peak считает пик яркости по кадрам (D3D11 поддерживает compute-шейдеры).
"#;

pub const DOC_EN: &str = r#"# ── Built-in profiles (chosen in Settings → MPV or with the P key) ──
# They are always available, there is no need to copy them into this file. To change a built-in profile,
# add a section with the same name here: it replaces the built-in one entirely.
#
# balanced     — movies and series: light deband, sharp upscaling, moderate load.
# quality      — maximum quality for powerful hardware and video up to 1080p: heavy scaling,
#                strong deband, HDR → SDR tone mapping. Weak machines may drop frames.
# fast         — light: 4K, weak hardware, virtual machine. Simple scaling, no deband.
# hdr-sdr      — HDR video on a regular (SDR) display: bt.2390 tone mapping compresses brightness to the screen range.
# smooth       — smooth motion 24→60 Hz: frame timing matched to the display plus interpolation.
#                Loads the GPU; if frames drop, go back to balanced.
# anime        — anime: stronger deband without grain (grain is visible on flat fills).
# night        — night mode: dynamic range compression and loudness normalization (quiet dialogue, loud explosions).
#
# Brightness, contrast, gamma and saturation (for example, for a dark video) are tuned during playback
# with the C key: the sliders apply immediately, are remembered and do not depend on the chosen profile.
#
# hdr-compute-peak measures the brightness peak per frame (D3D11 supports compute shaders).
"#;
