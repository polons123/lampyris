for (const key of [13, 27, 37, 38, 39, 40]) window.lampyrisTVKey(key);
if (dispatched.length !== 12 ||
    dispatched.map(event => event.which).join(',') !== '13,13,27,27,37,37,38,38,39,39,40,40' ||
    dispatched[0].type !== 'keydown' || dispatched[1].type !== 'keyup' ||
    dispatched[0].key !== 'Enter' || dispatched[2].key !== 'Escape' ||
    prefs.apple_tv_client !== 'lampyristv' ||
    prefs.navigation_type !== 'controll' ||
    prefs.keyboard_type !== 'lampa') {
    throw new Error('Unexpected remote input or Lampa preferences');
}
const assert = require('node:assert/strict');
Object.assign(prefs, {torrserver_auth:true, torrserver_url:'192.168.1.8:8090/base',
    torrserver_login:'test', torrserver_password:'a@b:c'});
const url = 'http://192.168.1.8:8090/base/stream/movie?link=x&index=1';
assert.deepEqual(window.lampyrisStreamCredentials(url), ['test','a@b:c']);
for (const wrong of [url.replace('8090','8080'), url.replace('/base','/other'), url.replace('index','x')])
    assert.equal(window.lampyrisStreamCredentials(wrong), null);
const L = window.Lampa;
L.Timeline = {filename:()=> 'test-profile', link:(card, season, episode)=>card && ({card:'tv_'+card.id, season, episode})};
const positions = [];
const play = (provider, season) => {
    const playlist = [1,2].map(episode=>({url:'https://'+provider+'.test/e'+episode,
        season, episode, timeline:{handler:(_, time)=>positions.push([episode,time])}}));
    L.Player.listener.external({...playlist[0], card:{id:123,media_type:'tv'},playlist});
    return window.lampyrisPlaybackItems(playlist[0].url);
};
const first = play('kinopub',1);
window.lampyrisSaveProgress(first[0].token, 18, 100);
window.lampyrisSaveProgress(first[1].token, 41, 100);
assert.deepEqual(positions, [[1,18],[2,41]]);
const second = play('torbox','1');
assert.deepEqual(first.map(i=>i.resumeID),second.map(i=>i.resumeID));
assert.notEqual(first[0].resumeID, first[1].resumeID);
window.lampyrisSaveProgress(first[0].token, 88, 100);
assert.equal(positions.length, 2);
console.log('Remote, credentials, episode identity and timeline smoke tests passed');
const torrentUrl = 'https://media.test/stream/' + encodeURIComponent('Хищник + Badlands.mkv') + '?link=abc&index=2';
L.Player.listener.external({url:torrentUrl});
assert.equal(window.lampyrisInfuseItems(torrentUrl, [], null, [torrentUrl])[torrentUrl].filename, 'Хищник + Badlands.mkv');
const direct = 'https://cdn.test/download?id=123';
L.Player.listener.external({url:direct, playlist:[{url:direct, path:'Folder/Мой фильм.mkv'}]});
assert.equal(window.lampyrisInfuseItems(direct, null, null, [direct])[direct].filename,'Мой фильм.mkv');
const streamID = 'eaaaa541-922e-4ce7-bb5b-c4acff18dcdd';
const opaqueURL = 'https://cdn.test/' + streamID;
L.Player.listener.external({url:opaqueURL, title:streamID, card:{title:'Дэдпул и Росомаха', release_date:'2024-07-24'}});
assert.equal(window.lampyrisInfuseItems(opaqueURL, null, null, [opaqueURL])[opaqueURL].filename,'Дэдпул и Росомаха (2024)');
const episodes = [1, 2, 3].map(episode => ({episode, season:1, title:'Episode ' + episode, url:'https://media.test/' + episode}));
L.Player.listener.external({...episodes[1], card:{id:321, media_type:'tv'}, playlist:episodes});
const queue = window.lampyrisPlaybackItems(episodes[1].url);
assert.deepEqual(queue.map(item => item.selected), [false, true, false]);
assert.deepEqual(queue.map(item => item.media.episode), [1, 2, 3]);
assert.equal(new Set(queue.map(item => item.media.seriesKey)).size, 1);
console.log('Full playlist and selected episode smoke test passed');
// A torrent may already have an older hash-specific marker for the same movie.
const movie = {id: 777, title: 'Movie'};
const torrentMarker = {hash: 71, time: 600, updated: 1000};
let linkedMarker = {time: 2400, updated: 2000};
L.Timeline.view = hash => hash === 0 ? linkedMarker : torrentMarker;
L.Player.listener.external({url: direct, card: movie, timeline: torrentMarker});
const resumeMovie = () => window.lampyrisPlaybackItems(direct)[0];
assert.equal(resumeMovie().resume, 2400);
linkedMarker = {time: 300, updated: 3000};
assert.equal(resumeMovie().resume, 300);
assert.equal(resumeMovie().resumeUpdated, 3000);
linkedMarker = {time: 0, updated: 4000};
assert.equal(resumeMovie().resume, 0);
console.log('Cross-source progress, rewind and reset tests passed');
