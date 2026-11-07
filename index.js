const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, delay } = require("@whiskeysockets/baileys");
const yts = require("yt-search");
const { spawn } = require("child_process");
const axios = require("axios");

const frasesDante = [
    "Let's rock, baby!",
    "Jackpot!",
    "This party's getting crazy! Let's animate it!",
    "Flock off, feather-face!",
    "You want a piece of me? Come get it!"
];
let indexFrase = 0;

const filaMúsicas = [];
let processandoFila = false;

function extrairTextoDoObjeto(msg) {
    if (!msg) return "";
    if (typeof msg === 'string') return msg;
    if (msg.conversation) return msg.conversation;
    if (msg.extendedTextMessage?.text) return msg.extendedTextMessage.text;
    if (msg.imageMessage?.caption) return msg.imageMessage.caption;
    if (msg.videoMessage?.caption) return msg.videoMessage.caption;
    const chaves = ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'documentWithCaptionMessage'];
    for (const chave of chaves) {
        if (msg[chave]?.message) return extrairTextoDoObjeto(msg[chave].message);
    }
    return "";
}

async function processarProximoDaFila(sock) {
    if (filaMúsicas.length === 0) {
        processandoFila = false;
        return;
    }
    processandoFila = true;
    const tarefa = filaMúsicas.shift();
    const { from, urlVideo, titulo, msg } = tarefa;

    try {
        // SERVIDOR DE NUVEM EXTRAINDO ÁUDIO EM ALTA VELOCIDADE DA BANDA
        const downloader = spawn("yt-dlp", [
            "--quiet", "--no-warnings", "--no-playlist", "--no-check-certificate",
            "--http-chunk-size", "1M", 
            "-f", "ba[ext=m4a]/ba",
            "-o", "-", urlVideo
        ]);

        const chunks = [];
        downloader.stdout.on("data", (chunk) => chunks.push(chunk));
        
        downloader.on("close", async (code) => {
            if (code === 0 && chunks.length > 0) {
                await sock.sendMessage(from, {
                    audio: Buffer.concat(chunks),
                    mimetype: "audio/mp4",
                    ptt: false
                }, { quoted: msg });
            }
            sock.sendPresenceUpdate('paused', from);
            processarProximoDaFila(sock);
        });
    } catch (err) {
        processandoFila = false;
        processarProximoDaFila(sock);
    }
}

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState("sessao_bot");
    
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true, // Desenha o QR code na tela da Render
        logger: require("pino")({ level: "fatal" }),
        markOnlineOnConnect: false,
        syncFullHistory: false,
        shouldIgnoreJid: () => false, 
        maxCachedMessages: 1
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
        if (type !== "notify") return;

        for (const msg of messages) {
            try {
                if (!msg.message) continue;
                
                const from = msg.key.remoteJid;
                const text = extrairTextoDoObjeto(msg.message).trim();
                const textLower = text.toLowerCase();

                if (textLower.startsWith(".play")) {
                    let args = text.substring(5).trim();
                    if (!args) {
                        await sock.sendMessage(from, { text: "🍕 *Dante:* Cadê a música?" }, { quoted: msg });
                        continue;
                    }

                    sock.sendPresenceUpdate('composing', from);
                    args = args.replace(/[^\w\s\d:\/\.\-\?\=\&]/gi, '');

                    const resultadoBusca = await yts(args);
                    if (resultadoBusca?.videos?.length > 0) {
                        const videoInfo = resultadoBusca.videos[0];
                        
                        await sock.sendMessage(from, { 
                            text: `🔴 *Música:* _${videoInfo.title}_\n⏱ *Tempo:* \`[ ${videoInfo.timestamp || "0:00"} ]\`\n\n🔥 _"${frasesDante[indexFrase]}"_ 🔫` 
                        }, { quoted: msg });

                        indexFrase = (indexFrase + 1) % frasesDante.length;
                        filaMúsicas.push({ from, urlVideo: videoInfo.url, titulo: videoInfo.title, msg });
                        
                        if (!processandoFila) processarProximoDaFila(sock);
                    }
                }
            } catch (e) {}
        }
    });

    sock.ev.on("connection.update", (update) => {
        const { connection } = update;
        if (connection === "close") startBot();
    });
}
startBot();
