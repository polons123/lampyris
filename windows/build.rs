fn main() {
    // Версия приложения одна на обе платформы (scripts/VERSION): расхождение с Cargo.toml ломает сборку, а не выпускает пакет с чужим номером.
    if let Ok(v) = std::fs::read_to_string("../scripts/VERSION") {
        assert_eq!(v.trim(), env!("CARGO_PKG_VERSION"), "версия в windows/Cargo.toml должна совпадать с scripts/VERSION");
    }
    println!("cargo:rerun-if-changed=../scripts/VERSION");
    // Значок и манифест exe (DPI, версии Windows, UTF-8, визуальные стили) — только при сборке под Windows.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        let mut res = winresource::WindowsResource::new();
        res.set_icon("icons/icon.ico");
        res.set_manifest_file("lampyris.manifest");
        res.set("ProductName", "Lampyris");
        res.set("FileDescription", "Lampyris — клиент Lampa");
        res.set("LegalCopyright", "GPL-3.0-or-later");
        res.compile().expect("не удалось встроить ресурсы exe");
    }
    println!("cargo:rerun-if-changed=icons/icon.ico");
    println!("cargo:rerun-if-changed=lampyris.manifest");
}
