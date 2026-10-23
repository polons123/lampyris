//! Согласование частоты обновления экрана с частотой кадров видео. Порт `LampyrisCore/DisplayRate.swift`
//! и `Lampyris/DisplayRateSwitcher.swift`. Windows сообщает частоты целыми числами (23.976 Гц приходит как 23 или 24, 59.94 как 59 или 60),
//! поэтому допуск здесь абсолютный (меньше 1 Гц), а не относительный как на macOS.

use windows::core::PCWSTR;
use windows::Win32::Foundation::HWND;
use windows::Win32::Graphics::Gdi::{
    ChangeDisplaySettingsExW, EnumDisplaySettingsW, GetMonitorInfoW, MonitorFromWindow, CDS_FULLSCREEN, CDS_TYPE, DEVMODEW, DISP_CHANGE_SUCCESSFUL,
    ENUM_CURRENT_SETTINGS, ENUM_DISPLAY_SETTINGS_MODE, MONITORINFO, MONITORINFOEXW, MONITOR_DEFAULTTONEAREST,
};

const MAX_MULTIPLE: i64 = 4;

/// Из доступных частот берёт ту, что равна частоте кадров или кратна ей (1×…4×); при равных кратностях побеждает меньшая.
/// None, если ничего не подошло или частота кадров неправдоподобна.
pub fn pick(fps: f64, rates: &[f64]) -> Option<f64> {
    if !fps.is_finite() || !(10.0..=120.0).contains(&fps) {
        return None;
    }
    for m in 1..=MAX_MULTIPLE {
        let target = fps * m as f64;
        let best = rates.iter().copied().filter(|r| *r > 0.0 && (r - target).abs() < 1.0).min_by(|a, b| (a - target).abs().total_cmp(&(b - target).abs()));
        if best.is_some() {
            return best;
        }
    }
    None
}

/// Переключает режим экрана и возвращает прежний. Работает только в полноэкранном окне. Режим ставится флагом
/// CDS_FULLSCREEN: он временный и сбрасывается системой при завершении процесса.
#[derive(Default)]
pub struct Switcher {
    /// Имя устройства экрана (UTF-16 с нулём), на котором режим изменён.
    changed: Option<Vec<u16>>,
}

impl Switcher {
    pub fn match_fps(&mut self, hwnd: isize, fullscreen: bool, fps: f64) {
        if !fullscreen {
            return;
        }
        let mut info = MONITORINFOEXW::default();
        info.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;
        let monitor = unsafe { MonitorFromWindow(HWND(hwnd as *mut _), MONITOR_DEFAULTTONEAREST) };
        if !unsafe { GetMonitorInfoW(monitor, &mut info as *mut MONITORINFOEXW as *mut MONITORINFO) }.as_bool() {
            return;
        }
        let device: Vec<u16> = info.szDevice.iter().copied().take_while(|c| *c != 0).chain(std::iter::once(0)).collect();
        let name = PCWSTR(device.as_ptr());
        let mut current = DEVMODEW { dmSize: std::mem::size_of::<DEVMODEW>() as u16, ..Default::default() };
        if !unsafe { EnumDisplaySettingsW(name, ENUM_CURRENT_SETTINGS, &mut current) }.as_bool() {
            return;
        }
        let mut modes: Vec<DEVMODEW> = Vec::new();
        let mut i = 0;
        loop {
            let mut dm = DEVMODEW { dmSize: std::mem::size_of::<DEVMODEW>() as u16, ..Default::default() };
            if !unsafe { EnumDisplaySettingsW(name, ENUM_DISPLAY_SETTINGS_MODE(i), &mut dm) }.as_bool() {
                break;
            }
            i += 1;
            // Тот же размер и глубина цвета, чтобы не менять картинку; поворот не трогаем.
            if dm.dmPelsWidth == current.dmPelsWidth && dm.dmPelsHeight == current.dmPelsHeight && dm.dmBitsPerPel == current.dmBitsPerPel {
                modes.push(dm);
            }
        }
        let rates: Vec<f64> = modes.iter().map(|m| m.dmDisplayFrequency as f64).collect();
        let Some(rate) = pick(fps, &rates) else {
            crate::log::info("display", &format!("режима под {fps} к/с нет: частота экрана не меняется"));
            return;
        };
        if rate as u32 == current.dmDisplayFrequency && self.changed.is_none() {
            return;
        }
        let Some(target) = modes.iter().find(|m| m.dmDisplayFrequency as f64 == rate) else { return };
        let rc = unsafe { ChangeDisplaySettingsExW(name, Some(target as *const DEVMODEW), None, CDS_FULLSCREEN, None) };
        if rc == DISP_CHANGE_SUCCESSFUL {
            self.changed = Some(device);
            crate::log::info("display", &format!("частота экрана {rate} Гц под {fps} к/с"));
        } else {
            crate::log::warn("display", &format!("режим экрана не принят системой: {}", rc.0));
        }
    }

    pub fn restore(&mut self) {
        let Some(device) = self.changed.take() else { return };
        // Пустой режим возвращает настройки из реестра, то есть те, что были до видео.
        unsafe { ChangeDisplaySettingsExW(PCWSTR(device.as_ptr()), None, None, CDS_TYPE(0), None) };
        crate::log::info("display", "режим экрана возвращён");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn film() {
        assert_eq!(pick(23.976, &[23.0, 30.0, 60.0]), Some(23.0));
        assert_eq!(pick(23.976, &[24.0, 30.0, 50.0, 60.0]), Some(24.0));
        assert_eq!(pick(23.976, &[48.0, 60.0]), Some(48.0));
    }

    #[test]
    fn pal_and_none() {
        assert_eq!(pick(25.0, &[24.0, 50.0, 60.0]), Some(50.0));
        assert_eq!(pick(23.976, &[30.0, 50.0, 60.0]), None);
        assert_eq!(pick(5.0, &[60.0]), None);
        assert_eq!(pick(f64::NAN, &[60.0]), None);
    }
}
