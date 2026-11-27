(function () {
    let viewport = document.querySelector('meta[name="viewport" i]');
    if (!viewport) {
        viewport = document.createElement('meta');
        viewport.name = 'viewport';
        document.head.appendChild(viewport);
    }
    const options = viewport.content.split(/[,;]/).map(value => value.trim())
        .filter(value => value && !/^viewport-fit\s*=/i.test(value));
    viewport.content = [...options, 'viewport-fit=cover'].join(', ');

    const ring = document.createElement('span');
    ring.className = 'lampyris-focus-ring';
    ring.setAttribute('aria-hidden', 'true');
    const focusStyle = document.createElement('style');
    focusStyle.textContent = `
        .head__action.appleTV_showadvancedmenu { display: none !important; }
        .card-episode.focus:has(> .lampyris-focus-ring) .full-episode::after { display: none !important; }
        .card:has(> .card__view) > .card__title {
            display: -webkit-box !important;
            visibility: visible !important;
            opacity: 1 !important;
            margin-top: .45em;
            line-height: 1.2;
            -webkit-box-orient: vertical;
            -webkit-line-clamp: 2;
            overflow: hidden;
        }
    `;
    document.head.appendChild(focusStyle);
    ring.style.cssText = 'position:absolute;inset:0;box-sizing:border-box;border:6px solid #ffda36;border-radius:12px;box-shadow:inset 0 0 0 2px #161616;z-index:2147483646;pointer-events:none';
    const posterSelector = '.card:has(> .card__view)';
    function restoreTitle(card) {
        const data = card.card_data;
        const name = data && (data.title || data.name || data.original_title || data.original_name);
        if (!name) return;
        let title = card.querySelector(':scope > .card__title');
        if (!title) {
            title = document.createElement('div');
            title.className = 'card__title';
            card.querySelector(':scope > .card__view').after(title);
        }
        if (!title.textContent.trim()) title.textContent = name;
    }
    function restorePosters(root) {
        const settingsSelector = '.settings-folder.appletv-setting';
        const folders = root.matches(settingsSelector) ? [root] : root.querySelectorAll(settingsSelector);
        for (const folder of folders) {
            const $ = window.jQuery || window.$;
            if (folder.dataset.component === 'lampyris-server') continue;
            const name = folder.querySelector('.settings-folder__name');
            if (!name) continue;
            folder.dataset.component = 'lampyris-server';
            folder.setAttribute('data-static', 'true');
            name.textContent = 'Адрес сервера Lampac';
            const icon = folder.querySelector('.settings-folder__icon');
            if (icon) icon.textContent = '⌁';
            if ($) $(folder).off('hover:enter').on('hover:enter', () => window.prompt('lampyris:server'));
        }
        if (root.matches(posterSelector)) restoreTitle(root);
        root.querySelectorAll(posterSelector).forEach(restoreTitle);
    }
    restorePosters(document.body);
    new MutationObserver(records => {
        for (const record of records) {
            for (const node of record.addedNodes) {
                if (node.nodeType === 1 && node !== ring) restorePosters(node);
            }
        }
    }).observe(document.body, { childList: true, subtree: true });

    function highlightCard(target) {
        ring.remove();
        if (!target.matches('.card, .selector[class*="card"], .selector:has(.card__view)')) return;
        if (getComputedStyle(target).position === 'static') target.style.position = 'relative';
        const poster = target.querySelector(':scope > .card__view');
        (poster || target).appendChild(ring);
    }
    document.addEventListener('hover:focus', event => highlightCard(event.target), true);
    const initialCard = document.querySelector('.selector.focus');
    if (initialCard) highlightCard(initialCard);

    const keys = {
        13: ['Enter', 'Enter'],
        27: ['Escape', 'Escape'],
        37: ['ArrowLeft', 'ArrowLeft'],
        38: ['ArrowUp', 'ArrowUp'],
        39: ['ArrowRight', 'ArrowRight'],
        40: ['ArrowDown', 'ArrowDown']
    };

    window.lampyrisTVKey = function (keyCode) {
        const controller = window.Lampa?.Controller;
        const direction = {37: 'left', 38: 'up', 39: 'right', 40: 'down'}[keyCode];
        if (direction && typeof controller?.move === 'function') {
            controller.move(direction);
            return;
        }
        if (keyCode === 13 && typeof controller?.enter === 'function') {
            controller.enter();
            return;
        }
        if (keyCode === 27 && typeof controller?.back === 'function') {
            controller.back();
            return;
        }
        const [key, code] = keys[keyCode];
        const target = document.activeElement || document.body || document;
        for (const type of ['keydown', 'keyup']) {
            const event = new KeyboardEvent(type, { key, code, bubbles: true, cancelable: true });
            Object.defineProperties(event, {
                keyCode: { value: keyCode },
                which: { value: keyCode }
            });
            target.dispatchEvent(event);
        }
    };

    window.lampyrisStreamCredentials = function (address) {
        const storage = window.Lampa && window.Lampa.Storage;
        if (!storage || !storage.field('torrserver_auth')) return null;
        const primary = storage.get('torrserver_url');
        const secondary = storage.get('torrserver_url_two');
        const active = storage.field('torrserver_use_link') === 'two'
            ? secondary || primary : primary || secondary;
        if (!active) return null;
        let server, stream;
        try {
            server = new URL(/^https?:\/\//i.test(active) ? active : window.location.protocol + '//' + active);
            stream = new URL(address);
        } catch { return null; }
        const base = server.pathname.replace(/\/+$/, '');
        const host = stream.hostname;
        const local = host === 'localhost' || host.endsWith('.local') ||
            /^[a-z0-9-]+$/i.test(host) || /^\[(?:::1\]|f[cd]|fe[89ab])/i.test(host) ||
            (/^\d+\.\d+\.\d+\.\d+$/.test(host) && /^(?:127|10|192\.168|172\.(?:1[6-9]|2\d|3[01])|169\.254)\./.test(host));
        const direct = stream.pathname.startsWith(base + '/stream/') && stream.searchParams.has('link');
        const gst = stream.pathname.startsWith(base + '/gst/') && stream.pathname.endsWith('/master.m3u8');
        if (!(stream.protocol === 'https:' || (stream.protocol === 'http:' && local)) || stream.origin !== server.origin ||
            stream.username || stream.password ||
            !(direct || gst) ||
            !stream.searchParams.has('index')) return null;
        const user = storage.get('torrserver_login');
        const password = storage.value('torrserver_password');
        return user && password ? [user, password] : null;
    };

    function configureLampa() {
        const storage = window.Lampa && window.Lampa.Storage;
        if (!storage) return;
        const editor = window.Lampa.Input;
        if (editor && typeof editor.edit === 'function') {
            const edit = editor.edit;
            editor.edit = function (params, callback) {
                if (params && (params.password || /парол|password/i.test(params.title || '')) &&
                    typeof callback === 'function') {
                    const password = window.prompt('lampyris:password');
                    if (password) callback(password);
                    return;
                }
                return edit.apply(this, arguments);
            };
        }
        if (storage.get('platform', '') !== 'apple_tv') storage.set('platform', 'apple_tv', true);
        if (storage.get('navigation_type', '') !== 'controll') storage.set('navigation_type', 'controll', true);
        storage.set('apple_tv_client', 'lampyristv');
        let fullCard;
        window.Lampa.Listener?.follow('full', event => {
            if (!['start', 'complite'].includes(event.type)) return;
            const card = event.data?.movie || event.object?.card;
            if (!card) return;
            const root = event.body?.[0] || event.body;
            const image = root?.querySelector?.('.full-start__background');
            fullCard = { ...card, image };
        });
        let selectedRelease;
        window.Lampa.Listener?.follow('torrent', event => {
            if (event.type === 'onenter') selectedRelease = event.element;
        });
        function torrentDetails(entry, current) {
            const hash = entry.torrent_hash || current.torrent_hash;
            if (!hash) return '';
            const magnet = selectedRelease?.MagnetUri || selectedRelease?.Link || '';
            const matched = magnet.match(/urn:btih:([a-z0-9]+)/i)?.[1]?.toLowerCase() === String(hash).toLowerCase();
            const release = matched ? selectedRelease : null;
            const rows = [];
            if (release?.Title) rows.push('Раздача   ' + release.Title);
            if (release?.Tracker) rows.push('Трекер   ' + release.Tracker);
            if (entry.path || entry.title) rows.push('Файл   ' + (entry.path || entry.title));
            if (entry.size) rows.push('Размер файла   ' + entry.size);
            if (release?.Seeders != null || release?.Peers != null)
                rows.push('По данным трекера   сиды: ' + (release.Seeders ?? '—') + '   пиры: ' + (release.Peers ?? '—'));
            const streams = entry.ffprobe || current.ffprobe;
            if (Array.isArray(streams)) {
                const tracks = streams.filter(s => s?.codec_type === 'audio').map(s =>
                    [s.tags?.language, s.tags?.title, s.codec_name, s.channel_layout].filter(Boolean).join(' · '));
                if (tracks.some(Boolean)) rows.push('Аудиодорожки раздачи   ' + [...new Set(tracks.filter(Boolean))].join(' / '));
            }
            return rows.join('\n');
        }
        let torrentSelection;
        window.Lampa.Listener?.follow('torrent_file', event => {
            if (event.type === 'onenter') torrentSelection = event.element;
        });
        let lastExternal;
        window.Lampa.Player?.listener?.follow('external', data => { lastExternal = data; });
        const pageSession = Array.from(crypto.getRandomValues(new Uint32Array(2))).join('-');
        let progressSession = 0;
        const progressWriters = new Map();
        window.lampyrisSaveProgress = (token, time, duration) => {
            if (duration > 0 && time >= 0) progressWriters.get(token)?.(time, duration);
        };
        const mediaExtension = /\.(mkv|mp4|m4v|mov|avi|ts|m2ts|webm|m3u8)$/i;
        function infuseName(url, entry, item, card, season, episode) {
            let stream;
            try { stream = new URL(url); } catch { return ''; }
            const leaf = value => typeof value === 'string' ? value.trim().split(/[\\/]/).pop() : '';
            let segment = stream.pathname.split('/').pop();
            try { segment = decodeURIComponent(segment); } catch {}
            const candidates = [item.filename, item.path, entry.filename, entry.path,
                item.name, item.title, entry.name, entry.title,
                stream.searchParams.get('filename'), segment].map(leaf);
            const useful = value => value && !/^(?:file|movie|video|download|stream|master|index|[a-f0-9-]{20,}|\d+)(?:\..*)?$/i.test(value);
            const file = candidates.find(name => useful(name) && mediaExtension.test(name));
            if (file) return file;
            const text = [card?.title, card?.name, card?.original_title, card?.original_name, item.title, item.name, entry.title, entry.name]
                .find(value => typeof value === 'string' && useful(value.trim()) && !/^https?:/i.test(value));
            if (!text) return '';
            let title = text.trim().replace(/[\\/]/g, ' ');
            if (episode != null && !/s\d+e\d+/i.test(title))
                title += ' S' + String(season ?? 1).padStart(2,'0') + 'E' + String(episode).padStart(2,'0');
            else if (episode == null) {
                const year = String(card?.release_date || '').slice(0,4);
                if (/^\d{4}$/.test(year) && !title.includes(year)) title += ' (' + year + ')';
            }
            const ext = candidates.map(name => name.match(mediaExtension)?.[0]).find(Boolean) || '';
            return title + ext;
        }
        const torBoxResolvers = new Map();
        let queueNumber = 0;
        window.lampyrisTorBoxQueue = (cell, selected, files, card, timeline, resolveFile) => {
            torBoxResolvers.clear();
            queueNumber++;
            const entries = files.map(file => {
                const active = file.id === selected.id;
                const key = [pageSession, queueNumber, file.id].join('/');
                const timing = active ? cell.timeline : timeline(file);
                torBoxResolvers.set(key, () => new Promise((done, fail) => resolveFile(file.id, done, fail)));
                return { url: active ? cell.url : new URL('/.lampyris-torbox/' + key, window.location.href).href,
                    torBoxKey: key, card, title: file.name, filename: file.name, path: file.path,
                    season: file.season, episode: file.episode, timeline: timing, torrent_hash: cell.torrent_hash };
            });
            const playing = entries.find(entry => entry.url === cell.url);
            if (playing) Object.assign(cell, playing, { playlist: entries });
        };
        window.lampyrisResolveTorBox = key => torBoxResolvers.get(key)?.();
        function torrentStatURL(address) {
            try {
                const stream = new URL(address);
                const server = new URL(window.Lampa.Torserver.url(), window.location.href);
                if (stream.origin !== server.origin) return '';
                const base = server.pathname.replace(/\/+$/, '');
                if (stream.pathname.startsWith(base + '/stream/') && stream.searchParams.has('link') && stream.searchParams.has('index')) {
                    stream.searchParams.delete('play');
                    stream.searchParams.delete('preload');
                    stream.searchParams.set('stat', '');
                    return stream.href;
                }
                if (stream.pathname.startsWith(base + '/gst/') && /\/gst\/[a-f0-9]{40}\/master\.m3u8$/i.test(stream.pathname)) {
                    stream.pathname = stream.pathname.replace(/master\.m3u8$/, 'heartbeat');
                    return stream.href;
                }
            } catch {}
            return '';
        }
        window.lampyrisTorrentStats = async address => {
            const url = torrentStatURL(address);
            if (!url) return '';
            const credentials = window.lampyrisStreamCredentials(address);
            const headers = {};
            if (credentials) headers.Authorization = 'Basic ' + btoa(unescape(encodeURIComponent(credentials.join(':'))));
            const response = await fetch(url, { headers, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(3500) });
            if (!response.ok) return '';
            const body = await response.json();
            const stats = body.Torrent || body;
            const rows = [];
            if (Number.isFinite(stats.download_speed)) rows.push('Загрузка торрента   ' + (stats.download_speed * 8 / 1e6).toFixed(2) + ' Мбит/с');
            if (Number.isFinite(stats.active_peers)) rows.push('Активные пиры   ' + stats.active_peers);
            return rows.join('\n');
        };
        window.lampyrisPlaybackItems = (address, playlist, segments) => {
            const L = window.Lampa;
            const resolve = value => {
                if (typeof value !== 'string' || !value) return '';
                try { return new URL(L.Torserver?.toPlayUrl?.(value) || value, window.location.href).href; }
                catch { return ''; }
            };
            function streamKey(value) {
                const resolved = resolve(value);
                if (!resolved) return '';
                const u = new URL(resolved);
                const hash = u.searchParams.get('link');
                const index = u.searchParams.get('index');
                if (hash && index && u.pathname.includes('/stream/'))
                    return JSON.stringify([u.origin, u.pathname.split('/stream/')[0], hash, index]);
                return resolved.replace(/%[0-9a-f]{2}/gi, escape => escape.toUpperCase());
            }
            const target = streamKey(address);

            const matches = item => item && (streamKey(item.url) === target ||
                Object.values(item.quality || {}).some(value => streamKey(value) === target));
            const candidates = [lastExternal, L.Player?.playdata?.(), torrentSelection].filter(matches);
            const current = candidates[0] || {};
            const lists = [...candidates.map(data => data.playlist), playlist, L.PlayerPlaylist?.get?.()]
                .filter(list => Array.isArray(list) && list.some(matches));
            const items = lists.reduce((best, list) => list.length > best.length ? list : best, []);
            if (!items.length) items.push(current);
            const index = Math.max(0, items.findIndex(matches));
            const active = L.Activity?.active?.();
            progressSession++;
            progressWriters.clear();
            const results = items.flatMap((item, i) => {
                if (!item || item.separator) return [];
                const selected = i === index;
                const url = selected ? address : resolve(item?.url);
                if (!/^https?:\/\//i.test(url)) return [];
                const timing = (selected && (segments || current.segments)) || item.segments;
                const entry = selected ? { ...item, ...current } : item;
                const cards = [entry.card, entry.movie, current.card, current.movie, active?.movie, active?.card];
                const fromDetail = ['online', 'torrents', 'torrent'].includes(active?.component);
                const sameTitle = entry.first_title && [fullCard?.name, fullCard?.title].includes(entry.first_title);
                const card = cards.find(candidate => candidate?.id) || ((fromDetail || sameTitle) ? fullCard : null);
                const remembered = card && fullCard && String(card.id) === String(fullCard.id) ? fullCard : null;
                const coverCards = [remembered, ...cards];
                const titleCard = coverCards.find(candidate => candidate?.title || candidate?.name || candidate?.original_title || candidate?.original_name);
                const artCard = coverCards.find(c => c && (c.desktopBackdrop || c.backdrop_path || c.background_image || c.poster_path || c.img || c.poster));
                let artwork = remembered?.image?.currentSrc || remembered?.image?.src || artCard?.desktopBackdrop || artCard?.backdrop_path || artCard?.background_image ||
                    artCard?.poster_path || artCard?.img || artCard?.poster || entry.img || entry.thumbnail || '';
                try {
                    if (artwork && !/^(https?:)?\/\//i.test(artwork)) artwork = L.Api.img(artwork, 'w1280');
                    if (artwork) artwork = new URL(artwork, window.location.href).href;
                } catch { artwork = ''; }
                const coverTitle = titleCard?.title || titleCard?.name || entry.first_title || entry.title || entry.name || '';
                const source = entry.timeline || item.timeline;
                const episodeText = [entry.title, entry.path, url].join(' ');
                const tagged = episodeText.match(/S(\d{1,2})[. :_-]*E(\d{1,3})/i);
                const episode = Number(entry.episode || entry.episode_number || source?.episode || tagged?.[2] ||
                    entry.title?.match?.(/(?:серия|episode)\s*(\d+)/i)?.[1]) || null;
                const series = episode !== null || card?.media_type === 'tv' || card?.original_name || card?.first_air_date || card?.number_of_seasons;
                const season = series ? Number(entry.season ?? entry.season_number ?? source?.season ?? tagged?.[1] ??
                    entry.title?.match?.(/\bS(\d+)\s*\//i)?.[1] ?? 1) : null;
                const linkCard = card && series && !card.original_name ? { ...card, original_name: card.name || true } : card;
                const link = (!series || episode) ? L.Timeline?.link?.(linkCard, season, episode) : null;
                const binding = link || (typeof source?.card === 'string' ? source : null);
                const identity = binding ? [binding.card, binding.season == null ? null : Number(binding.season),
                    binding.episode == null ? null : Number(binding.episode)] : null;
                const hash = source?.hash || (identity && L.Utils?.hash?.(JSON.stringify(identity)));
                const timeline = hash ? L.Timeline?.view?.(hash, link) : null;
                // Hash 0 is reserved by Lampa. Reading it with a card binding looks
                // up the latest linked record across hashes without writing a marker.
                const linked = binding && L.Timeline?.view?.(0, binding);
                const progress = [timeline, source, linked].filter(row => row &&
                    (Number(row.updated) > 0 || Number(row.time) > 0)).reduce((best, row) =>
                    !best || (Number(row.updated) || 0) > (Number(best.updated) || 0) ? row : best, null);
                const token = pageSession + ':' + progressSession + ':' + i;
                const profile = L.Timeline?.filename?.() || 'local';
                if (source?.handler || timeline?.handler) {
                    progressWriters.set(token, (time, duration) => {
                        const percent = Math.min(100, Math.round(time * 100 / duration));
                        if (timeline?.handler && link) timeline.handler(percent, time, duration);
                        else if (source?.handler) source.handler(percent, time, duration);
                        else timeline.handler(percent, time, duration);
                        if (source) Object.assign(source, { percent, time, duration });
                    });
                }
                return [{ url, token, selected, artwork, coverTitle, media: { matchRate: String(storage.get('lampyris_mpv_match_rate', true)) !== 'false', torBoxKey: item.torBoxKey || '', statsAddress: !item.torBoxKey && torrentStatURL(url) ? url : '', torrentDetails: torrentDetails(entry, current), tmdb: Number(card?.id) || 0,
                    imdb: card?.imdb_id || card?.external_ids?.imdb_id || '', series: !!series,
                    season: Number(season) || 0, episode: Number(episode) || 0,
                    seriesKey: series && card?.id ? JSON.stringify([profile, card.id]) : '' }, resumeID: identity || hash ? JSON.stringify([profile, identity || hash]) : '',
                    filename: infuseName(url, entry, item, titleCard, season, episode),
                    duration: Number(timeline?.duration || source?.duration) || 0,
                    resume: Number(progress?.time) || 0, resumeUpdated: Number(progress?.updated) || 0, title: episode && coverTitle ? coverTitle + ' · S' + String(season).padStart(2, '0') + 'E' + String(episode).padStart(2, '0') : String(coverTitle || item.title || item.name || ''),
                    skip: Array.isArray(timing?.skip) ? timing.skip : [],
                    credentials: window.lampyrisStreamCredentials(url) }];
            });
            const playing = results.find(item => item.selected);
            if (playing?.media.episode && (current.torrent_hash || items[index]?.torrent_hash ||
                /\/(?:stream|gst)\//i.test(address))) {
                return results.filter(item => item.media.season === playing.media.season && item.media.episode > 0)
                    .sort((a, b) => a.media.episode - b.media.episode);
            }
            return results;
        };
        window.lampyrisInfuseItems = (address, playlist, segments, addresses) => {
            const items = window.lampyrisPlaybackItems(address, playlist, segments);
            return Object.fromEntries(addresses.map(url => [url, items.find(item => item.url === url) ||
                { filename: infuseName(url, {}, {}, null), credentials: window.lampyrisStreamCredentials(url) }]));
        };
        function configurePlayers() {
            // Lampa's tvos key already sends lampa://video with the resolved stream URL.
            const api = window.Lampa.SettingsApi;
            const key = 'lampyris_mpv_match_rate';
            if (api && !api.getParam('player')?.some(row => row.param.name === key)) {
                api.addParam({
                    component: 'player', param: { name: key, type: 'trigger', default: true },
                    field: { name: 'Подстройка частоты экрана под фильм', description: 'Используется в mpv' },
                    onRender(item) {
                        queueMicrotask(() => {
                            const row = item[0];
                            if (row.parentElement) row.parentElement.prepend(row);
                        });
                    }
                });
            }
            const players = { tvos: 'mpv', infuse: 'Infuse', inner: '#{settings_param_player_inner}' };
            for (const name of ['player', 'player_torrent', 'player_iptv']) {
                const defaultPlayer = name === 'player_iptv' ? 'inner' : 'tvos';
                window.Lampa.Params.select(name, { ...players }, defaultPlayer);
                const saved = storage.get(name, defaultPlayer);
                if (!Object.hasOwn(players, saved)) storage.set(name, defaultPlayer);
            }
        }
        if (window.appready) configurePlayers();
        else window.Lampa.Listener.follow('app', event => {
            if (event.type === 'ready') configurePlayers();
        });
        if (!storage.get('lampyris_tv_configured', false)) {
            storage.set('keyboard_type', 'lampa');
            storage.set('lampyris_tv_configured', true);
        }
    }

    if (window.appready || (window.Lampa && window.Lampa.Storage)) configureLampa();
    else {
        let attempts = 0;
        const timer = setInterval(function () {
            if (window.Lampa && window.Lampa.Storage) {
                clearInterval(timer);
                configureLampa();
            } else if (++attempts >= 40) {
                clearInterval(timer);
            }
        }, 250);
    }
})();
