import Foundation

extension MpvConfig {
    /// Встроенные профили: есть всегда, пользовательский mpv.conf может заменить любой одноимённым разделом.
    /// Список и значения общие с Windows (`windows/src/mpv_profiles.rs`): менять оба сразу.
    /// Описания профилей лежат в шаблоне mpv.conf (`AppDelegate.openMpvConf`).
    public static let builtinProfiles = """
[balanced]
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
"""
}
