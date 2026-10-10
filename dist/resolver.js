import { LoadType } from 'shoukaku';
import { UserError } from './errors.js';
const hosts = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'soundcloud.com', 'www.soundcloud.com', 'm.soundcloud.com', 'on.soundcloud.com', 'open.spotify.com']);
export function searchIdentifier(query, source = 'youtube') {
    query = query.trim();
    if (!query || query.length > 500 || /[\x00-\x1f]/.test(query))
        throw new UserError('Nhập tên bài hoặc link hợp lệ, tối đa 500 ký tự.');
    if (/^https?:\/\//i.test(query)) {
        let url;
        try {
            url = new URL(query);
        }
        catch {
            throw new UserError('Link không hợp lệ.');
        }
        if (!hosts.has(url.hostname.toLowerCase()) || url.username || url.password || url.port || url.protocol !== 'https:')
            throw new UserError('Chỉ nhận link HTTPS từ YouTube, SoundCloud hoặc open.spotify.com.');
        url.hash = '';
        return url.href;
    }
    if (/^[a-z][a-z\d+.-]*:/i.test(query))
        throw new UserError('Hãy dán link HTTPS hoặc nhập tên bài hát.');
    return `${({ youtube: 'ytsearch', soundcloud: 'scsearch', spotify: 'spsearch' })[source]}:${query}`;
}
export function normalizeTrack(track, requesterId) {
    return { encoded: track.encoded, identifier: track.info.identifier, title: track.info.title, author: track.info.author,
        uri: track.info.uri ?? '', source: track.info.sourceName, length: track.info.length, isStream: track.info.isStream,
        artwork: track.info.artworkUrl, requesterId };
}
export function unpack(result, requester, limit, allSearch = false) {
    if (!result || result.loadType === LoadType.EMPTY)
        throw new UserError('Không tìm thấy bài hát. Thử tên bài khác hoặc đổi nguồn tìm kiếm.');
    if (result.loadType === LoadType.ERROR)
        throw new UserError('Nguồn nhạc chưa tải được. Kiểm tra plugin/quyền truy cập Lavalink hoặc thử nguồn khác.');
    const all = result.loadType === LoadType.TRACK ? [result.data] : result.loadType === LoadType.PLAYLIST ? result.data.tracks : allSearch ? result.data : result.data.slice(0, 1);
    if (!all.length)
        throw new UserError('Danh sách nhạc đang trống hoặc không thể truy cập.');
    return { tracks: all.slice(0, limit).map(t => normalizeTrack(t, requester)), total: all.length,
        title: result.loadType === LoadType.PLAYLIST ? result.data.info.name : all[0].info.title };
}
export function trackKey(track) { return `${track.source}:${track.identifier}`; }
export function chooseRecommendation(candidates, recent) {
    const keys = new Set(recent.map(trackKey));
    const titles = new Set(recent.map(t => `${t.author} ${t.title}`.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')));
    return candidates.find(t => !t.isStream && t.length > 30000 && !keys.has(trackKey(t)) && !titles.has(`${t.author} ${t.title}`.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')));
}
//# sourceMappingURL=resolver.js.map