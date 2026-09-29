/** Demo recordings (public/demo), analysed live in the browser exactly like a file you load. */
export interface DemoSong {
  id: string;
  file: string;
  title: string;
  artist: string;
  character: string;
  licence: string;
  source: string;
}

export const DEMO_SONGS: DemoSong[] = [
  {
    id: 'vibe-ace',
    file: 'demo/vibe-ace.mp3',
    title: 'Vibe Ace',
    artist: 'Kevin MacLeod',
    character: 'upbeat, funky',
    licence: 'CC BY 3.0',
    source: 'https://freemusicarchive.org/music/Kevin_MacLeod/Jazz_Sampler/Vibe_Ace',
  },
  {
    id: 'hungarian-dance-5',
    file: 'demo/hungarian-dance-5.mp3',
    title: 'Hungarian Dance No. 5',
    artist: 'Brahms, US Army Strings',
    character: 'fiery, minor key',
    licence: 'Public domain',
    source: 'https://musopen.org/music/43805-hungarian-dance-no-5-in-f-sharp-minor-woo-1-string-orchestra-arr/',
  },
  {
    id: 'sugar-plum-fairy',
    file: 'demo/sugar-plum-fairy.mp3',
    title: 'Dance of the Sugar Plum Fairy',
    artist: 'Tchaikovsky, arr. Kevin MacLeod',
    character: 'delicate, mysterious',
    licence: 'CC BY 3.0',
    source: 'https://freemusicarchive.org/music/Kevin_MacLeod/Classical_Sampler/Dance_of_the_Sugar_Plum_Fairy',
  },
];

export async function loadDemoSong(song: DemoSong): Promise<File> {
  const res = await fetch(`./${song.file}`);
  if (!res.ok) throw new Error(`Could not load the demo song (HTTP ${res.status}).`);
  return new File([await res.blob()], `${song.title} - ${song.artist}.mp3`, { type: 'audio/mpeg' });
}
