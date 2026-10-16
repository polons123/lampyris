//! Готовые профили для шаблона mpv.conf. Список и значения общие с macOS (`AppDelegate.openMpvConf`):
//! менять оба сразу; отличаются только комментарии про рендерер (здесь gpu-next, там gpu).

pub const RU: &str = r#"# ── Готовые профили (выбираются в Настройки → MPV или клавишей P) ──
# Здесь рендерер gpu-next (libplacebo, D3D11): работают все опции профилей.

[balanced]
# Сбалансированное качество для фильмов и сериалов: лёгкая подчистка полос (deband),
# чёткое увеличение. Подходит большинству видео, нагрузка умеренная.
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
# Максимум качества для Apple Silicon Pro/Max и видео до 1080p: тяжёлое масштабирование,
# сильный deband, тон-маппинг HDR → SDR. На слабых машинах возможны пропуски кадров.
# hdr-compute-peak считает пик яркости по кадрам (нужны compute-шейдеры, в D3D11 они есть).
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
# Лёгкий: 4K, слабое железо, виртуальная машина. Простое масштабирование, без deband.
scale=bilinear
cscale=bilinear
dscale=bilinear
deband=no
dither-depth=no
correct-downscaling=no
sigmoid-upscaling=no

[hdr-sdr]
# HDR-видео на обычном (SDR) мониторе: тон-маппинг bt.2390 сжимает яркость в диапазон экрана.
# hdr-compute-peak считает пик яркости по кадрам (см. [quality]).
tone-mapping=bt.2390
hdr-compute-peak=yes
target-peak=auto
deband=no

[smooth]
# Плавное движение 24→60 Гц: подгонка кадров под частоту экрана и интерполяция.
# Нагружает GPU; если кадры пропускаются, вернитесь на [balanced].
video-sync=display-resample
interpolation=yes
tscale=oversample

[anime]
# Аниме: сильнее подчистка полос без добавления зерна (на плоских заливках зерно заметно).
scale=ewa_lanczossharp
cscale=ewa_lanczossharp
sigmoid-upscaling=yes
deband=yes
deband-iterations=3
deband-threshold=48
deband-range=16
deband-grain=0

[night]
# Ночной режим: сжатие динамического диапазона и выравнивание громкости (тихие диалоги, громкие взрывы).
af=acompressor=ratio=4,loudnorm=I=-16:TP=-1.5:LRA=11

[dark]
# Тёмная картинка: умеренно поднимает тени. Для ручного тюнинга меняйте значения ниже.
# Диапазон каждого параметра от -100 до 100, 0 — без изменений. Менять по 5–10 за раз.
# gamma      — главный параметр: поднимает полутона и тени, почти не трогая белое.
# brightness — сдвигает всё, включая чёрный: слишком много даёт серую «дымку».
# contrast   — растягивает яркость; после поднятия gamma чуть добавьте, чтобы вернуть глубину.
# saturation — тёмные кадры выглядят блёклыми, +5…+10 возвращает цвет.
# deband     — в поднятых тенях проступают полосы, поэтому подчистка включена сильнее.
gamma=20
brightness=8
contrast=6
saturation=6
deband=yes
deband-iterations=3
deband-threshold=45
deband-range=20
deband-grain=6

[dark-extreme]
# Очень тёмная картинка (ночные сцены, плохая раскодировка, тёмный экран). Сильно поднимает
# тени за счёт шума и потери глубины чёрного. Если слишком ярко, уменьшите gamma на 10.
# Параметры те же, что в [dark]; начинать подбор стоит с gamma.
gamma=45
brightness=15
contrast=12
saturation=12
deband=yes
deband-iterations=4
deband-threshold=55
deband-range=24
deband-grain=10
dither-depth=auto
"#;

pub const EN: &str = r#"# ── Ready-made profiles (chosen in Settings → MPV or with the P key) ──
# Rendering here uses gpu-next (libplacebo, D3D11): all profile options work.

[balanced]
# Balanced quality for movies and series: light deband,
# sharp upscaling. Fits most videos, moderate load.
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
# Maximum quality for Apple Silicon Pro/Max and video up to 1080p: heavy scaling,
# strong deband, HDR → SDR tone mapping. Weak machines may drop frames.
# hdr-compute-peak measures the brightness peak per frame (needs compute shaders, which D3D11 has).
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
# Light: 4K, weak hardware, virtual machine. Simple scaling, no deband.
scale=bilinear
cscale=bilinear
dscale=bilinear
deband=no
dither-depth=no
correct-downscaling=no
sigmoid-upscaling=no

[hdr-sdr]
# HDR video on a regular (SDR) display: bt.2390 tone mapping compresses brightness to the screen range.
# hdr-compute-peak measures the brightness peak per frame (see [quality]).
tone-mapping=bt.2390
hdr-compute-peak=yes
target-peak=auto
deband=no

[smooth]
# Smooth motion 24→60 Hz: frame timing matched to the display plus interpolation.
# Loads the GPU; if frames drop, go back to [balanced].
video-sync=display-resample
interpolation=yes
tscale=oversample

[anime]
# Anime: stronger deband without grain (grain is visible on flat fills).
scale=ewa_lanczossharp
cscale=ewa_lanczossharp
sigmoid-upscaling=yes
deband=yes
deband-iterations=3
deband-threshold=48
deband-range=16
deband-grain=0

[night]
# Night mode: dynamic range compression and loudness normalization (quiet dialogue, loud explosions).
af=acompressor=ratio=4,loudnorm=I=-16:TP=-1.5:LRA=11

[dark]
# Dark picture: moderately lifts shadows. Edit the values below for manual tuning.
# Each parameter ranges from -100 to 100, 0 means unchanged. Change by 5–10 at a time.
# gamma      — the main knob: lifts midtones and shadows, barely touching whites.
# brightness — shifts everything including black: too much gives a grey haze.
# contrast   — stretches brightness; after raising gamma add a little to bring back depth.
# saturation — dark frames look washed out, +5…+10 brings the colour back.
# deband     — banding shows in lifted shadows, so debanding is stronger.
gamma=20
brightness=8
contrast=6
saturation=6
deband=yes
deband-iterations=3
deband-threshold=45
deband-range=20
deband-grain=6

[dark-extreme]
# Very dark picture (night scenes, poor encodes, dim screen). Lifts shadows strongly
# at the cost of noise and black depth. If too bright, lower gamma by 10.
# Same parameters as in [dark]; start tuning with gamma.
gamma=45
brightness=15
contrast=12
saturation=12
deband=yes
deband-iterations=4
deband-threshold=55
deband-range=24
deband-grain=10
dither-depth=auto
"#;
