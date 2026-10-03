/**
 * Chooses the music for where the player is: a track for some scenes (the
 * match), silence for others (an error), and the default (the menus) for
 * the rest. It follows the scene manager and asks the game's sound for the
 * track; the same track carries on uninterrupted from one menu to the next.
 */

export class MusicDirector {
  #audio;
  #tracks;
  #fallback;

  /**
   * @param {{ audio: { playMusic: (track: string | null) => void }, tracks: Readonly<Record<string, string | null>>, fallback: string | null }} deps
   *   `tracks`: the track for each scene that has its own (a MusicTrack; null for silence); `fallback`: every other scene's
   */
  constructor({ audio, tracks, fallback }) {
    this.#audio = audio;
    this.#tracks = tracks;
    this.#fallback = fallback;
  }

  /**
   * @param {string} sceneId
   * @returns {string | null} the track that plays there
   */
  trackFor(sceneId) {
    return Object.hasOwn(this.#tracks, sceneId) ? this.#tracks[sceneId] : this.#fallback;
  }

  /**
   * Plays the music for each scene the player is taken to.
   * @param {{ onNavigate: (listener: (sceneId: string) => void) => () => void, currentId: string | null }} scenes the SceneManager
   * @returns {() => void} stops following
   */
  follow(scenes) {
    if (scenes.currentId !== null) {
      this.#audio.playMusic(this.trackFor(scenes.currentId));
    }
    return scenes.onNavigate((sceneId) => this.#audio.playMusic(this.trackFor(sceneId)));
  }
}
