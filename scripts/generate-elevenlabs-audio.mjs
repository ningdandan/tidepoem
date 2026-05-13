import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, '..');

const DEFAULT_SOURCE = 'historical_sea_poems.json';
const DEFAULT_OUTPUT_DIR = 'audio/poems';
const DEFAULT_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'JBFqnCBsd6RMkjVDRZzb';
const DEFAULT_MODEL_ID = process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2';
const DEFAULT_OUTPUT_FORMAT = 'mp3_44100_128';

function parseArgs(argv) {
    const options = {
        source: DEFAULT_SOURCE,
        outDir: DEFAULT_OUTPUT_DIR,
        force: false,
        ids: null,
        speed: null
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];

        if (arg === '--force') {
            options.force = true;
            continue;
        }

        if (arg === '--source' && argv[index + 1]) {
            options.source = argv[index + 1];
            index += 1;
            continue;
        }

        if (arg === '--out-dir' && argv[index + 1]) {
            options.outDir = argv[index + 1];
            index += 1;
            continue;
        }

        if (arg === '--id' && argv[index + 1]) {
            options.ids = argv[index + 1]
                .split(',')
                .map((value) => Number.parseInt(value.trim(), 10))
                .filter((value) => Number.isFinite(value));
            index += 1;
            continue;
        }

        if (arg === '--speed' && argv[index + 1]) {
            const speed = Number.parseFloat(argv[index + 1]);
            options.speed = Number.isFinite(speed) ? speed : null;
            index += 1;
            continue;
        }
    }

    return options;
}

function buildNarrationText(poem) {
    const intro = [`${poem.title}.`, `By ${poem.author}.`];

    return `${intro.join(' ')}\n\n${poem.body.trim()}`;
}

function getOutputFilename(poem) {
    return `${String(poem.id).padStart(3, '0')}.mp3`;
}

async function fileExists(targetPath) {
    try {
        await access(targetPath);
        return true;
    } catch {
        return false;
    }
}

async function streamToBuffer(stream) {
    const arrayBuffer = await new Response(stream).arrayBuffer();
    return Buffer.from(arrayBuffer);
}

async function main() {
    if (!process.env.ELEVENLABS_API_KEY) {
        throw new Error('Missing ELEVENLABS_API_KEY. Export it before running this script.');
    }

    const { source, outDir, force, ids, speed } = parseArgs(process.argv.slice(2));
    const sourcePath = path.resolve(workspaceRoot, source);
    const outputDir = path.resolve(workspaceRoot, outDir);

    const fileContents = await readFile(sourcePath, 'utf8');
    const collection = JSON.parse(fileContents);
    const allPoems = Array.isArray(collection.poems) ? collection.poems : [];
    const poems = ids && ids.length
        ? allPoems.filter((poem) => ids.includes(Number(poem.id)))
        : allPoems;

    if (!poems.length) {
        throw new Error(`No poems found in ${source}.`);
    }

    await mkdir(outputDir, { recursive: true });

    const elevenlabs = new ElevenLabsClient({
        apiKey: process.env.ELEVENLABS_API_KEY
    });

    console.log(`Generating ${poems.length} poem narration files...`);
    console.log(`Voice: ${DEFAULT_VOICE_ID}`);
    console.log(`Model: ${DEFAULT_MODEL_ID}`);
    if (speed !== null) {
        console.log(`Speed: ${speed}`);
    }

    for (const poem of poems) {
        const outputPath = path.join(outputDir, getOutputFilename(poem));
        const alreadyExists = await fileExists(outputPath);

        if (alreadyExists && !force) {
            console.log(`Skipping ${poem.id}: ${poem.title} (already exists)`);
            continue;
        }

        console.log(`Generating ${poem.id}: ${poem.title}`);

        const audioStream = await elevenlabs.textToSpeech.convert(DEFAULT_VOICE_ID, {
            text: buildNarrationText(poem),
            modelId: DEFAULT_MODEL_ID,
            outputFormat: DEFAULT_OUTPUT_FORMAT,
            voiceSettings: speed !== null ? { speed } : undefined
        }, {
            timeoutInSeconds: 180
        });

        const audioBuffer = await streamToBuffer(audioStream);
        await writeFile(outputPath, audioBuffer);
    }

    console.log(`Done. Audio files saved to ${path.relative(workspaceRoot, outputDir)}`);
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
