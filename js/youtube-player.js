/**
 * YouTube IFrame Player API Manager
 */
export class YouTubePlayerManager {
  constructor() {
    this.player = null;
    this.playlist = [];
    this.currentIndex = 0;
    this.isReady = false;
    this.callbacks = {};
  }

  on(event, fn) {
    this.callbacks[event] = fn;
  }

  emit(event, ...data) {
    if (this.callbacks[event]) {
      this.callbacks[event](...data);
    }
  }

  /**
   * Initialize YouTube API & mount player iframe
   */
  init(containerId = 'yt-player') {
    return new Promise((resolve) => {
      // Load YouTube IFrame API script dynamically if not present
      if (!window.YT) {
        const tag = document.createElement('script');
        tag.src = "https://www.youtube.com/iframe_api";
        const firstScriptTag = document.getElementsByTagName('script')[0];
        firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
      }

      window.onYouTubeIframeAPIReady = () => {
        this.createPlayer(containerId, resolve);
      };

      if (window.YT && window.YT.Player) {
        this.createPlayer(containerId, resolve);
      }
    });
  }

  createPlayer(containerId, resolve) {
    this.player = new window.YT.Player(containerId, {
      height: '1',
      width: '1',
      playerVars: {
        'autoplay': 0,
        'controls': 0,
        'disablekb': 1,
        'fs': 0,
        'rel': 0,
        'playsinline': 1
      },
      events: {
        'onReady': () => {
          this.isReady = true;
          resolve();
        },
        'onStateChange': (event) => {
          this.emit('stateChange', event.data);
        }
      }
    });
  }

  /**
   * Helper to extract YouTube Video ID from URL
   */
  extractVideoId(url) {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : url;
  }

  setPlaylist(urlArray) {
    this.playlist = urlArray.map(url => this.extractVideoId(url));
    this.currentIndex = 0;
    if (this.playlist.length > 0) {
      this.loadCurrentTrack();
    }
  }

  loadCurrentTrack() {
    if (!this.isReady || !this.playlist[this.currentIndex]) return;
    const videoId = this.playlist[this.currentIndex];
    this.player.cueVideoById(videoId);
    this.emit('trackChanged', { index: this.currentIndex, videoId });
  }

  play() {
    if (!this.isReady || !this.player.playVideo) return;
    this.player.playVideo();
  }

  pause() {
    if (!this.isReady || !this.player.pauseVideo) return;
    this.player.pauseVideo();
  }

  nextTrack() {
    if (this.playlist.length === 0) return;
    this.currentIndex = (this.currentIndex + 1) % this.playlist.length;
    this.loadCurrentTrack();
  }

  seekTo(seconds) {
    if (!this.isReady || !this.player.seekTo) return;
    this.player.seekTo(seconds, true);
  }

  getCurrentTime() {
    if (!this.isReady || !this.player.getCurrentTime) return 0;
    return this.player.getCurrentTime();
  }

  getDuration() {
    if (!this.isReady || !this.player.getDuration) return 0;
    return this.player.getDuration();
  }

  mute() {
    if (!this.isReady || !this.player.mute) return;
    this.player.mute();
  }

  unmute() {
    if (!this.isReady || !this.player.unMute) return;
    this.player.unMute();
  }
}
