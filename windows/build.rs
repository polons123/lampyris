fn main() {
    // Версия приложения одна на macOS и Windows: scripts/VERSION. В Cargo.toml она не дублируется (там 0.0.0).
    let version = std::fs::read_to_string("../scripts/VERSION").expect("не найден scripts/VERSION").trim().to_string();
    let parts: Vec<u64> = version.split('.').map(|p| p.parse().expect("версия в scripts/VERSION должна быть вида 1.2.3")).collect();
    assert_eq!(parts.len(), 3, "версия в scripts/VERSION должна быть вида 1.2.3");
    println!("cargo:rerun-if-changed=../scripts/VERSION");
    println!("cargo:rustc-env=LAMPYRIS_VERSION={version}");
    // Значок и манифест exe (DPI, версии Windows, UTF-8, визуальные стили) — только при сборке под Windows.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        let mut res = winresource::WindowsResource::new();
        res.set_icon("icons/icon.ico");
        res.set_manifest_file("lampyris.manifest");
        let packed = (parts[0] << 48) | (parts[1] << 32) | (parts[2] << 16);
        res.set_version_info(winresource::VersionInfo::FILEVERSION, packed);
        res.set_version_info(winresource::VersionInfo::PRODUCTVERSION, packed);
        res.set("FileVersion", &version);
        res.set("ProductVersion", &version);
        res.set("ProductName", "Lampyris");
        res.set("FileDescription", "Lampyris — клиент Lampa");
        res.set("LegalCopyright", "GPL-3.0-or-later");
        res.compile().expect("не удалось встроить ресурсы exe");
    }
    println!("cargo:rerun-if-changed=icons/icon.ico");
    println!("cargo:rerun-if-changed=lampyris.manifest");
}
