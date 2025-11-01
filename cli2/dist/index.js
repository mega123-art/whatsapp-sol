#!/usr/bin/env node
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const web3_js_1 = require("@solana/web3.js");
const commander_1 = require("commander");
const fs = __importStar(require("fs"));
const crypto = __importStar(require("crypto"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
// Using require for Chalk and Ora since they are common JS modules
const chalk = require("chalk");
const ora = require("ora");
// Program ID - MUST match the ID in your Anchor program
const PROGRAM_ID = new web3_js_1.PublicKey("9tN5NBvynubfJwQWDqrSoHEE3Xy2MVj3BmHdLu13wCcS");
// ============================================================================
// Instruction Discriminators (Sighashes)
// --- CORRECTED VALUES from the provided IDL ---
// ============================================================================
const DISCRIMINATORS = {
    // Instruction Discriminator (Hex)
    initializeThread: "cf4e5bb957f48e0b", // [207, 78, 91, 185, 87, 244, 142, 11]
    sendMessage: "392822b2bd0a411a", // [57, 40, 34, 178, 189, 10, 65, 26]
    initializeChannel: "e85bb1d47a5ee3fa", // [232, 91, 177, 212, 122, 94, 227, 250]
    sendBroadcast: "e9f1484d97932059", // [233, 241, 72, 77, 151, 147, 32, 89]
    subscribeChannel: "ca978c2427df6cb1", // [202, 151, 140, 36, 39, 223, 108, 177]
    closeThread: "35e71031f7656d0b", // [53, 231, 16, 49, 247, 101, 109, 11]
    closeChannel: "006824014200679d", // [0, 104, 36, 1, 66, 0, 103, 157]
};
// ============================================================================
// Utility Functions
// ============================================================================
/**
 * Loads the user's Solana wallet keypair.
 * @param walletPath Optional path to the keypair file. Defaults to ~/.config/solana/id.json.
 */
function loadWallet(walletPath) {
    const walletFile = walletPath || path.join(os.homedir(), ".config", "solana", "idother.json");
    if (!fs.existsSync(walletFile)) {
        throw new Error(`Wallet file not found at ${walletFile}. Please specify --wallet path.`);
    }
    const secretKey = JSON.parse(fs.readFileSync(walletFile, "utf-8"));
    return web3_js_1.Keypair.fromSecretKey(Uint8Array.from(secretKey));
}
/**
 * Creates a Connection object for the specified cluster.
 */
function createConnection(cluster) {
    let url;
    switch (cluster.toLowerCase()) {
        case "mainnet":
        case "mainnet-beta":
            url = "https://api.mainnet-beta.solana.com";
            break;
        case "devnet":
            url = "https://api.devnet.solana.com";
            break;
        case "testnet":
            url = "https://api.testnet.solana.com";
            break;
        case "localhost":
        case "localnet":
            url = "http://localhost:8899";
            break;
        default:
            url = cluster;
    }
    return new web3_js_1.Connection(url, "confirmed");
}
/**
 * Derives the Program Derived Address for a MessageThread.
 */
function deriveThreadPDA(participantA, participantB, threadId) {
    return web3_js_1.PublicKey.findProgramAddressSync([
        Buffer.from("message_thread"),
        participantA.toBuffer(),
        participantB.toBuffer(),
        threadId,
    ], PROGRAM_ID);
}
/**
 * Derives the Program Derived Address for a BroadcastChannel.
 */
function deriveChannelPDA(owner, channelName) {
    return web3_js_1.PublicKey.findProgramAddressSync([
        Buffer.from("broadcast_channel"),
        owner.toBuffer(),
        Buffer.from(channelName),
    ], PROGRAM_ID);
}
/**
 * Derives the Program Derived Address for a ChannelSubscription.
 */
function deriveSubscriptionPDA(channel, subscriber) {
    return web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("subscription"), channel.toBuffer(), subscriber.toBuffer()], PROGRAM_ID);
}
/**
 * Simple AES-256-CBC encryption for demo purposes.
 */
function encryptMessage(message, sharedSecret) {
    const cipher = crypto.createCipheriv("aes-256-cbc", crypto.scryptSync(sharedSecret, "salt", 32), Buffer.alloc(16, 0));
    return Buffer.concat([cipher.update(message, "utf8"), cipher.final()]);
}
/**
 * Simple AES-256-CBC decryption for demo purposes.
 */
function decryptMessage(encrypted, sharedSecret) {
    const decipher = crypto.createDecipheriv("aes-256-cbc", crypto.scryptSync(sharedSecret, "salt", 32), Buffer.alloc(16, 0));
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}
// ============================================================================
// Commands
// ============================================================================
/**
 * Initialize a new message thread between two participants.
 */
async function initThreadCommand(options) {
    console.log(chalk.bold.cyan("\n💬 Initialize Message Thread\n"));
    const spinner = ora();
    try {
        spinner.start("Loading wallet and connecting to Solana...");
        const wallet = loadWallet(options.wallet);
        const connection = createConnection(options.cluster);
        const participantB = new web3_js_1.PublicKey(options.recipient);
        // Generate unique thread ID
        const threadId = crypto.randomBytes(32);
        const [threadPDA] = deriveThreadPDA(wallet.publicKey, participantB, threadId);
        spinner.succeed(chalk.green(`Connected to ${options.cluster}`));
        console.log(chalk.gray(`  Your address: ${wallet.publicKey.toBase58()}`));
        console.log(chalk.gray(`  Recipient: ${participantB.toBase58()}`));
        console.log(chalk.gray(`  Thread PDA: ${threadPDA.toBase58()}\n`));
        spinner.start("Initializing message thread...");
        // Build initialize instruction
        const initData = Buffer.concat([
            // Use the hex discriminator for clarity and verification
            Buffer.from(DISCRIMINATORS.initializeThread, "hex"),
            threadId,
        ]);
        const initIx = new web3_js_1.TransactionInstruction({
            programId: PROGRAM_ID,
            keys: [
                { pubkey: threadPDA, isSigner: false, isWritable: true },
                { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
                { pubkey: participantB, isSigner: false, isWritable: false },
                { pubkey: web3_js_1.SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            data: initData,
        });
        const tx = new web3_js_1.Transaction().add(initIx);
        const sig = await (0, web3_js_1.sendAndConfirmTransaction)(connection, tx, [wallet], {
            commitment: "confirmed",
        });
        spinner.succeed(chalk.green(`Thread initialized!`));
        console.log(chalk.gray(`  Signature: ${sig}`));
        console.log(chalk.cyan(`\nThread PDA: ${threadPDA.toBase58()}\n`));
        console.log(chalk.gray(`Save this PDA to send and receive messages in this thread.`));
        process.exit(0);
    }
    catch (error) {
        spinner.fail(chalk.red("Failed to initialize thread"));
        console.error(chalk.red(`\n❌ Error: ${error.message}`));
        process.exit(1);
    }
}
/**
 * Send a message in a message thread.
 */
async function sendMessageCommand(options) {
    console.log(chalk.bold.cyan("\n📤 Send Message\n"));
    const spinner = ora();
    try {
        spinner.start("Loading wallet and connecting to Solana...");
        const wallet = loadWallet(options.wallet);
        const connection = createConnection(options.cluster);
        const threadPDA = new web3_js_1.PublicKey(options.thread);
        spinner.succeed(chalk.green(`Connected to ${options.cluster}`));
        console.log(chalk.gray(`  Thread: ${threadPDA.toBase58()}\n`));
        // Get thread info to determine next message index
        spinner.start("Fetching thread information...");
        const accountInfo = await connection.getAccountInfo(threadPDA);
        if (!accountInfo) {
            throw new Error("Thread not found. Invalid PDA or thread doesn't exist.");
        }
        // message_count offset for MessageThread: 8 (disc) + 32 + 32 + 32 = 104
        const messageCount = accountInfo.data.readUInt32LE(104);
        spinner.succeed(chalk.green(`Thread found`));
        console.log(chalk.gray(`  Current messages: ${messageCount}\n`));
        // Encrypt message
        spinner.start("Encrypting message...");
        const sharedSecret = options.key || "default-secret-key";
        const encrypted = encryptMessage(options.message, sharedSecret);
        spinner.succeed(chalk.green(`Message encrypted`));
        console.log(chalk.gray(`  Size: ${encrypted.length} bytes\n`));
        // Send message
        spinner.start("Sending message...");
        const messageData = Buffer.concat([
            // Use the hex discriminator for clarity and verification
            Buffer.from(DISCRIMINATORS.sendMessage, "hex"),
            Buffer.from(new Uint32Array([messageCount]).buffer), // message_index (u32)
            Buffer.from(new Uint32Array([encrypted.length]).buffer), // content length (u32)
            encrypted, // encrypted_content (Vec<u8>)
        ]);
        const sendIx = new web3_js_1.TransactionInstruction({
            programId: PROGRAM_ID,
            keys: [
                { pubkey: threadPDA, isSigner: false, isWritable: true },
                { pubkey: wallet.publicKey, isSigner: true, isWritable: false },
            ],
            data: messageData,
        });
        const tx = new web3_js_1.Transaction().add(sendIx);
        const sig = await (0, web3_js_1.sendAndConfirmTransaction)(connection, tx, [wallet], {
            commitment: "confirmed",
        });
        spinner.succeed(chalk.green(`Message sent!`));
        console.log(chalk.gray(`  Signature: ${sig}`));
        console.log(chalk.gray(`  Message index: ${messageCount}\n`));
        process.exit(0);
    }
    catch (error) {
        spinner.fail(chalk.red("Failed to send message"));
        console.error(chalk.red(`\n❌ Error: ${error.message}`));
        process.exit(1);
    }
}
/**
 * Read and decrypt messages from a thread's transaction history.
 */
async function readMessagesCommand(options) {
    console.log(chalk.bold.cyan("\n📖 Read Messages (Direct Thread)\n"));
    const spinner = ora();
    try {
        spinner.start("Connecting to Solana...");
        const connection = createConnection(options.cluster);
        const threadPDA = new web3_js_1.PublicKey(options.thread);
        spinner.succeed(chalk.green(`Connected to ${options.cluster}`));
        console.log(chalk.gray(`  Thread: ${threadPDA.toBase58()}\n`));
        // Fetch thread metadata
        spinner.start("Fetching thread metadata...");
        const accountInfo = await connection.getAccountInfo(threadPDA);
        if (!accountInfo) {
            throw new Error("Thread not found.");
        }
        const data = accountInfo.data;
        const participantA = new web3_js_1.PublicKey(data.slice(8, 40));
        const participantB = new web3_js_1.PublicKey(data.slice(40, 72));
        // message_count offset for MessageThread: 8 (disc) + 32 + 32 + 32 = 104
        const messageCount = data.readUInt32LE(104);
        spinner.succeed(chalk.green(`Thread metadata retrieved`));
        console.log(chalk.gray(`  Participant A: ${participantA.toBase58()}`));
        console.log(chalk.gray(`  Participant B: ${participantB.toBase58()}`));
        console.log(chalk.gray(`  Total messages: ${messageCount}\n`));
        // Fetch transaction history
        spinner.start("Fetching transaction history...");
        const signatures = await connection.getSignaturesForAddress(threadPDA, {
            limit: 1000,
        });
        spinner.succeed(chalk.green(`Found ${signatures.length} transactions\n`));
        // Extract messages
        spinner.start("Extracting messages...");
        const messages = [];
        const sharedSecret = options.key || "default-secret-key";
        // send_message discriminator prefix for quick check
        const SEND_MESSAGE_DISCRIMINATOR = Buffer.from(DISCRIMINATORS.sendMessage, "hex");
        for (const sigInfo of signatures) {
            // NOTE: This can be slow for a thread with thousands of messages
            try {
                const tx = await connection.getTransaction(sigInfo.signature, {
                    maxSupportedTransactionVersion: 0,
                });
                if (!tx || !tx.transaction)
                    continue;
                const message = tx.transaction.message;
                if ("compiledInstructions" in message) {
                    for (const ix of message.compiledInstructions) {
                        const programId = message.staticAccountKeys[ix.programIdIndex];
                        if (programId.equals(PROGRAM_ID)) {
                            const ixData = Buffer.from(ix.data);
                            // Check for send_message discriminator
                            if (ixData.length > 8 &&
                                ixData.subarray(0, 8).equals(SEND_MESSAGE_DISCRIMINATOR)) {
                                const messageIndex = ixData.readUInt32LE(8); // u32
                                const contentLength = ixData.readUInt32LE(12); // u32
                                const encrypted = ixData.slice(16, 16 + contentLength);
                                try {
                                    const decrypted = decryptMessage(encrypted, sharedSecret);
                                    // Sender is key 1 in the instruction's account list
                                    // 0: threadPDA, 1: sender
                                    const sender = message.staticAccountKeys[ix.accountKeyIndexes[1]];
                                    messages.push({
                                        index: messageIndex,
                                        sender: sender.toBase58(),
                                        content: decrypted,
                                        timestamp: tx.blockTime,
                                    });
                                }
                                catch (e) {
                                    console.log(chalk.yellow(`  ⚠️  Failed to decrypt message ${messageIndex} (${sigInfo.signature.substring(0, 4)}...)`));
                                }
                            }
                        }
                    }
                }
            }
            catch (error) {
                // Skip transactions that failed to fetch or parse
            }
        }
        messages.sort((a, b) => a.index - b.index);
        spinner.succeed(chalk.green(`Extracted ${messages.length} messages\n`));
        // Display messages
        console.log(chalk.bold("Messages:\n"));
        for (const msg of messages) {
            const date = msg.timestamp
                ? new Date(msg.timestamp * 1000).toLocaleString()
                : "Unknown";
            console.log(chalk.cyan(`[${msg.index}] ${date}`));
            console.log(chalk.gray(`From: ${msg.sender}`));
            console.log(chalk.white(`${msg.content}\n`));
        }
        process.exit(0);
    }
    catch (error) {
        spinner.fail(chalk.red("Failed to read messages"));
        console.error(chalk.red(`\n❌ Error: ${error.message}`));
        process.exit(1);
    }
}
/**
 * Initialize a new broadcast channel.
 */
async function createChannelCommand(options) {
    console.log(chalk.bold.cyan("\n📢 Create Broadcast Channel\n"));
    const spinner = ora();
    try {
        spinner.start("Loading wallet and connecting to Solana...");
        const wallet = loadWallet(options.wallet);
        const connection = createConnection(options.cluster);
        const [channelPDA] = deriveChannelPDA(wallet.publicKey, options.name);
        spinner.succeed(chalk.green(`Connected to ${options.cluster}`));
        console.log(chalk.gray(`  Owner: ${wallet.publicKey.toBase58()}`));
        console.log(chalk.gray(`  Channel PDA: ${channelPDA.toBase58()}\n`));
        spinner.start("Creating broadcast channel...");
        // Build initialize instruction
        const channelNameBytes = Buffer.from(options.name, "utf8");
        const initData = Buffer.concat([
            // Use the hex discriminator for clarity and verification
            Buffer.from(DISCRIMINATORS.initializeChannel, "hex"),
            Buffer.from(new Uint32Array([channelNameBytes.length]).buffer),
            channelNameBytes,
        ]);
        const initIx = new web3_js_1.TransactionInstruction({
            programId: PROGRAM_ID,
            keys: [
                { pubkey: channelPDA, isSigner: false, isWritable: true },
                { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
                { pubkey: web3_js_1.SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            data: initData,
        });
        const tx = new web3_js_1.Transaction().add(initIx);
        const sig = await (0, web3_js_1.sendAndConfirmTransaction)(connection, tx, [wallet], {
            commitment: "confirmed",
        });
        spinner.succeed(chalk.green(`Channel created!`));
        console.log(chalk.gray(`  Signature: ${sig}`));
        console.log(chalk.cyan(`\nChannel PDA: ${channelPDA.toBase58()}\n`));
        console.log(chalk.gray(`Share this PDA with users who want to subscribe.`));
        process.exit(0);
    }
    catch (error) {
        spinner.fail(chalk.red("Failed to create channel"));
        console.error(chalk.red(`\n❌ Error: ${error.message}`));
        process.exit(1);
    }
}
/**
 * Send a broadcast message to a channel.
 */
async function sendBroadcastCommand(options) {
    console.log(chalk.bold.cyan("\n📡 Send Broadcast Message\n"));
    const spinner = ora();
    try {
        spinner.start("Loading wallet and connecting to Solana...");
        const wallet = loadWallet(options.wallet);
        const connection = createConnection(options.cluster);
        const channelPDA = new web3_js_1.PublicKey(options.channel);
        spinner.succeed(chalk.green(`Connected to ${options.cluster}`));
        console.log(chalk.gray(`  Channel: ${channelPDA.toBase58()}\n`));
        // Get channel info to determine next message index
        spinner.start("Fetching channel information...");
        const accountInfo = await connection.getAccountInfo(channelPDA);
        if (!accountInfo) {
            throw new Error("Channel not found. Invalid PDA or channel doesn't exist.");
        }
        // message_count offset for BroadcastChannel: 8 (disc) + 32 + 4 + 32 = 76 (Max name size)
        const messageCount = accountInfo.data.readUInt32LE(76);
        spinner.succeed(chalk.green(`Channel found`));
        console.log(chalk.gray(`  Current broadcasts: ${messageCount}\n`));
        // Encrypt message
        spinner.start("Encrypting broadcast content...");
        const sharedSecret = options.key || "default-channel-key";
        const encrypted = encryptMessage(options.message, sharedSecret);
        spinner.succeed(chalk.green(`Content encrypted`));
        console.log(chalk.gray(`  Size: ${encrypted.length} bytes\n`));
        // Send broadcast
        spinner.start("Sending broadcast...");
        const broadcastData = Buffer.concat([
            // Use the hex discriminator for clarity and verification
            Buffer.from(DISCRIMINATORS.sendBroadcast, "hex"),
            Buffer.from(new Uint32Array([messageCount]).buffer), // message_index (u32)
            Buffer.from(new Uint32Array([encrypted.length]).buffer), // content length (u32)
            encrypted, // encrypted_content (Vec<u8>)
        ]);
        const sendIx = new web3_js_1.TransactionInstruction({
            programId: PROGRAM_ID,
            keys: [
                { pubkey: channelPDA, isSigner: false, isWritable: true },
                { pubkey: wallet.publicKey, isSigner: true, isWritable: false }, // Sender is the channel owner
            ],
            data: broadcastData,
        });
        const tx = new web3_js_1.Transaction().add(sendIx);
        const sig = await (0, web3_js_1.sendAndConfirmTransaction)(connection, tx, [wallet], {
            commitment: "confirmed",
        });
        spinner.succeed(chalk.green(`Broadcast sent!`));
        console.log(chalk.gray(`  Signature: ${sig}`));
        console.log(chalk.gray(`  Message index: ${messageCount}\n`));
        process.exit(0);
    }
    catch (error) {
        spinner.fail(chalk.red("Failed to send broadcast"));
        console.error(chalk.red(`\n❌ Error: ${error.message}`));
        process.exit(1);
    }
}
/**
 * Subscribe to a broadcast channel.
 */
async function subscribeChannelCommand(options) {
    console.log(chalk.bold.cyan("\n➕ Subscribe to Channel\n"));
    const spinner = ora();
    try {
        spinner.start("Loading wallet and connecting to Solana...");
        const wallet = loadWallet(options.wallet);
        const connection = createConnection(options.cluster);
        const channelPDA = new web3_js_1.PublicKey(options.channel);
        const [subscriptionPDA] = deriveSubscriptionPDA(channelPDA, wallet.publicKey);
        spinner.succeed(chalk.green(`Connected to ${options.cluster}`));
        console.log(chalk.gray(`  Subscriber: ${wallet.publicKey.toBase58()}`));
        console.log(chalk.gray(`  Channel: ${channelPDA.toBase58()}`));
        console.log(chalk.gray(`  Subscription PDA: ${subscriptionPDA.toBase58()}\n`));
        spinner.start("Creating subscription account...");
        // Build subscribe instruction
        const subscribeData = Buffer.from(DISCRIMINATORS.subscribeChannel, "hex");
        const subscribeIx = new web3_js_1.TransactionInstruction({
            programId: PROGRAM_ID,
            keys: [
                { pubkey: subscriptionPDA, isSigner: false, isWritable: true }, // subscription PDA (init)
                { pubkey: channelPDA, isSigner: false, isWritable: true }, // broadcast_channel (mut)
                { pubkey: wallet.publicKey, isSigner: true, isWritable: true }, // subscriber (signer, mut, payer)
                { pubkey: web3_js_1.SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            data: subscribeData,
        });
        const tx = new web3_js_1.Transaction().add(subscribeIx);
        const sig = await (0, web3_js_1.sendAndConfirmTransaction)(connection, tx, [wallet], {
            commitment: "confirmed",
        });
        spinner.succeed(chalk.green(`Subscription successful!`));
        console.log(chalk.gray(`  Signature: ${sig}`));
        console.log(chalk.cyan(`\nSubscription PDA: ${subscriptionPDA.toBase58()}\n`));
        process.exit(0);
    }
    catch (error) {
        spinner.fail(chalk.red("Failed to subscribe to channel"));
        console.error(chalk.red(`\n❌ Error: ${error.message}`));
        process.exit(1);
    }
}
/**
 * Read and decrypt messages from a broadcast channel's transaction history.
 */
async function readBroadcastsCommand(options) {
    console.log(chalk.bold.cyan("\n📡 Read Broadcast Messages\n"));
    const spinner = ora();
    try {
        spinner.start("Connecting to Solana...");
        const connection = createConnection(options.cluster);
        const channelPDA = new web3_js_1.PublicKey(options.channel);
        spinner.succeed(chalk.green(`Connected to ${options.cluster}`));
        console.log(chalk.gray(`  Channel: ${channelPDA.toBase58()}\n`));
        // Fetch channel metadata
        spinner.start("Fetching channel metadata...");
        const accountInfo = await connection.getAccountInfo(channelPDA);
        if (!accountInfo) {
            throw new Error("Channel not found.");
        }
        const channelData = accountInfo.data;
        const owner = new web3_js_1.PublicKey(channelData.slice(8, 40));
        const channelNameLen = channelData.readUInt32LE(40);
        const channelName = channelData
            .slice(44, 44 + channelNameLen)
            .toString("utf8");
        const messageCount = channelData.readUInt32LE(76);
        spinner.succeed(chalk.green(`Channel metadata retrieved`));
        console.log(chalk.gray(`  Owner: ${owner.toBase58()}`));
        console.log(chalk.gray(`  Channel Name: ${channelName}`));
        console.log(chalk.gray(`  Total broadcasts: ${messageCount}\n`));
        // Fetch transaction history
        spinner.start("Fetching transaction history...");
        const signatures = await connection.getSignaturesForAddress(channelPDA, {
            limit: 1000,
        });
        spinner.succeed(chalk.green(`Found ${signatures.length} transactions\n`));
        // Extract messages
        spinner.start("Extracting messages...");
        const messages = [];
        const sharedSecret = options.key || "default-channel-key";
        // send_broadcast discriminator prefix
        const SEND_BROADCAST_DISCRIMINATOR = Buffer.from(DISCRIMINATORS.sendBroadcast, "hex");
        for (const sigInfo of signatures) {
            try {
                const tx = await connection.getTransaction(sigInfo.signature, {
                    maxSupportedTransactionVersion: 0,
                });
                if (!tx || !tx.transaction)
                    continue;
                const message = tx.transaction.message;
                if ("compiledInstructions" in message) {
                    for (const ix of message.compiledInstructions) {
                        const programId = message.staticAccountKeys[ix.programIdIndex];
                        if (programId.equals(PROGRAM_ID)) {
                            const ixData = Buffer.from(ix.data);
                            // Check for send_broadcast discriminator
                            if (ixData.length > 8 &&
                                ixData.subarray(0, 8).equals(SEND_BROADCAST_DISCRIMINATOR)) {
                                const messageIndex = ixData.readUInt32LE(8); // u32
                                const contentLength = ixData.readUInt32LE(12); // u32
                                const encrypted = ixData.slice(16, 16 + contentLength);
                                try {
                                    const decrypted = decryptMessage(encrypted, sharedSecret);
                                    // Sender is key 1 in the instruction's account list
                                    // 0: channelPDA, 1: sender (owner)
                                    const sender = message.staticAccountKeys[ix.accountKeyIndexes[1]];
                                    messages.push({
                                        index: messageIndex,
                                        sender: sender.toBase58(),
                                        content: decrypted,
                                        timestamp: tx.blockTime,
                                    });
                                }
                                catch (e) {
                                    console.log(chalk.yellow(`  ⚠️  Failed to decrypt broadcast ${messageIndex} (${sigInfo.signature.substring(0, 4)}...)`));
                                }
                            }
                        }
                    }
                }
            }
            catch (error) {
                // Skip transactions that failed to fetch or parse
            }
        }
        messages.sort((a, b) => a.index - b.index);
        spinner.succeed(chalk.green(`Extracted ${messages.length} broadcasts\n`));
        // Display messages
        console.log(chalk.bold("Broadcasts:\n"));
        for (const msg of messages) {
            const date = msg.timestamp
                ? new Date(msg.timestamp * 1000).toLocaleString()
                : "Unknown";
            console.log(chalk.cyan(`[${msg.index}] ${date}`));
            console.log(chalk.gray(`From: ${msg.sender} (Owner)`));
            console.log(chalk.white(`${msg.content}\n`));
        }
        process.exit(0);
    }
    catch (error) {
        spinner.fail(chalk.red("Failed to read broadcasts"));
        console.error(chalk.red(`\n❌ Error: ${error.message}`));
        process.exit(1);
    }
}
/**
 * Close a message thread and refund rent.
 */
async function closeThreadCommand(options) {
    console.log(chalk.bold.cyan("\n🗑️ Close Message Thread\n"));
    const spinner = ora();
    try {
        spinner.start("Loading wallet and connecting to Solana...");
        const wallet = loadWallet(options.wallet);
        const connection = createConnection(options.cluster);
        const threadPDA = new web3_js_1.PublicKey(options.thread);
        const recipient = new web3_js_1.PublicKey(options.recipient || wallet.publicKey); // Default refund to self
        spinner.succeed(chalk.green(`Connected to ${options.cluster}`));
        console.log(chalk.gray(`  Signer (Participant A): ${wallet.publicKey.toBase58()}`));
        console.log(chalk.gray(`  Thread: ${threadPDA.toBase58()}`));
        console.log(chalk.gray(`  Recipient (Refund): ${recipient.toBase58()}\n`));
        spinner.start("Closing thread and refunding rent...");
        // Build close instruction
        const closeData = Buffer.from(DISCRIMINATORS.closeThread, "hex");
        const closeIx = new web3_js_1.TransactionInstruction({
            programId: PROGRAM_ID,
            keys: [
                { pubkey: threadPDA, isSigner: false, isWritable: true },
                { pubkey: wallet.publicKey, isSigner: true, isWritable: false }, // participant_a
                { pubkey: recipient, isSigner: false, isWritable: true }, // recipient (mut)
            ],
            data: closeData,
        });
        const tx = new web3_js_1.Transaction().add(closeIx);
        const sig = await (0, web3_js_1.sendAndConfirmTransaction)(connection, tx, [wallet], {
            commitment: "confirmed",
        });
        spinner.succeed(chalk.green(`Thread closed successfully!`));
        console.log(chalk.gray(`  Signature: ${sig}`));
        process.exit(0);
    }
    catch (error) {
        spinner.fail(chalk.red("Failed to close thread"));
        console.error(chalk.red(`\n❌ Error: ${error.message}`));
        process.exit(1);
    }
}
/**
 * Close a broadcast channel and refund rent.
 */
async function closeChannelCommand(options) {
    console.log(chalk.bold.cyan("\n🗑️ Close Broadcast Channel\n"));
    const spinner = ora();
    try {
        spinner.start("Loading wallet and connecting to Solana...");
        const wallet = loadWallet(options.wallet);
        const connection = createConnection(options.cluster);
        const channelPDA = new web3_js_1.PublicKey(options.channel);
        const recipient = new web3_js_1.PublicKey(options.recipient || wallet.publicKey); // Default refund to self
        spinner.succeed(chalk.green(`Connected to ${options.cluster}`));
        console.log(chalk.gray(`  Signer (Owner): ${wallet.publicKey.toBase58()}`));
        console.log(chalk.gray(`  Channel: ${channelPDA.toBase58()}`));
        console.log(chalk.gray(`  Recipient (Refund): ${recipient.toBase58()}\n`));
        spinner.start("Closing channel and refunding rent...");
        // Build close instruction
        const closeData = Buffer.from(DISCRIMINATORS.closeChannel, "hex");
        const closeIx = new web3_js_1.TransactionInstruction({
            programId: PROGRAM_ID,
            keys: [
                { pubkey: channelPDA, isSigner: false, isWritable: true },
                { pubkey: wallet.publicKey, isSigner: true, isWritable: false }, // owner
                { pubkey: recipient, isSigner: false, isWritable: true }, // recipient (mut)
            ],
            data: closeData,
        });
        const tx = new web3_js_1.Transaction().add(closeIx);
        const sig = await (0, web3_js_1.sendAndConfirmTransaction)(connection, tx, [wallet], {
            commitment: "confirmed",
        });
        spinner.succeed(chalk.green(`Channel closed successfully!`));
        console.log(chalk.gray(`  Signature: ${sig}`));
        process.exit(0);
    }
    catch (error) {
        spinner.fail(chalk.red("Failed to close channel"));
        console.error(chalk.red(`\n❌ Error: ${error.message}`));
        process.exit(1);
    }
}
// ============================================================================
// CLI Setup
// ============================================================================
const program = new commander_1.Command();
program
    .name("sol-msg")
    .description("Solana Messaging Protocol - Send encrypted messages on-chain")
    .version("1.0.0");
// ------------------------------------
// THREAD COMMANDS
// ------------------------------------
// Initialize thread
program
    .command("init-thread")
    .description("Initialize a new message thread with another user")
    .requiredOption("-r, --recipient <address>", "Recipient's public key")
    .option("-w, --wallet <path>", "Path to wallet keypair file")
    .option("-c, --cluster <cluster>", "Solana cluster", "devnet")
    .action(initThreadCommand);
// Send message
program
    .command("send")
    .description("Send a message in a thread")
    .requiredOption("-t, --thread <address>", "Thread PDA address")
    .requiredOption("-m, --message <text>", "Message to send")
    .option("-k, --key <secret>", "Encryption key (shared secret)")
    .option("-w, --wallet <path>", "Path to wallet keypair file")
    .option("-c, --cluster <cluster>", "Solana cluster", "devnet")
    .action(sendMessageCommand);
// Read messages
program
    .command("read")
    .description("Read messages from a thread")
    .requiredOption("-t, --thread <address>", "Thread PDA address")
    .option("-k, --key <secret>", "Decryption key (shared secret)")
    .option("-c, --cluster <cluster>", "Solana cluster", "devnet")
    .action(readMessagesCommand);
// Close thread
program
    .command("close-thread")
    .description("Close a message thread and refund rent to an account")
    .requiredOption("-t, --thread <address>", "Thread PDA address")
    .option("-r, --recipient <address>", "Account to receive the rent refund (defaults to signer)")
    .option("-w, --wallet <path>", "Path to wallet keypair file")
    .option("-c, --cluster <cluster>", "Solana cluster", "devnet")
    .action(closeThreadCommand);
// ------------------------------------
// CHANNEL COMMANDS
// ------------------------------------
// Create channel
program
    .command("create-channel")
    .description("Create a broadcast channel")
    .requiredOption("-n, --name <name>", "Channel name (max 32 chars)")
    .option("-w, --wallet <path>", "Path to wallet keypair file")
    .option("-c, --cluster <cluster>", "Solana cluster", "devnet")
    .action(createChannelCommand);
// Subscribe channel
program
    .command("subscribe")
    .description("Subscribe to a broadcast channel")
    .requiredOption("-ch, --channel <address>", "Channel PDA address")
    .option("-w, --wallet <path>", "Path to wallet keypair file")
    .option("-c, --cluster <cluster>", "Solana cluster", "devnet")
    .action(subscribeChannelCommand);
// Send broadcast
program
    .command("send-broadcast")
    .description("Send a broadcast message to a channel (must be the owner)")
    .requiredOption("-ch, --channel <address>", "Channel PDA address")
    .requiredOption("-m, --message <text>", "Message to broadcast")
    .option("-k, --key <secret>", "Encryption key (shared secret for all channel messages)")
    .option("-w, --wallet <path>", "Path to wallet keypair file")
    .option("-c, --cluster <cluster>", "Solana cluster", "devnet")
    .action(sendBroadcastCommand);
// Read broadcasts (NEW COMMAND)
program
    .command("read-broadcasts")
    .description("Read messages broadcast on a channel")
    .requiredOption("-ch, --channel <address>", "Channel PDA address")
    .option("-k, --key <secret>", "Decryption key (shared secret)")
    .option("-c, --cluster <cluster>", "Solana cluster", "devnet")
    .action(readBroadcastsCommand);
// Close channel
program
    .command("close-channel")
    .description("Close a broadcast channel and refund rent to an account")
    .requiredOption("-ch, --channel <address>", "Channel PDA address")
    .option("-r, --recipient <address>", "Account to receive the rent refund (defaults to signer)")
    .option("-w, --wallet <path>", "Path to wallet keypair file")
    .option("-c, --cluster <cluster>", "Solana cluster", "devnet")
    .action(closeChannelCommand);
// ------------------------------------
// HELP AND PARSE
// ------------------------------------
program.on("--help", () => {
    console.log("");
    console.log(chalk.bold("Examples:"));
    console.log(chalk.yellow("  --- Direct Messaging ---"));
    console.log("  $ sol-msg init-thread -r <recipient_pubkey> -c devnet");
    console.log('  $ sol-msg send -t <thread_pda> -m "Hello!" -k mykey -c devnet');
    console.log("  $ sol-msg read -t <thread_pda> -k mykey -c devnet");
    console.log("  $ sol-msg close-thread -t <thread_pda>");
    console.log(chalk.yellow("\n  --- Broadcast Channels ---"));
    console.log('  $ sol-msg create-channel -n "Announcements"');
    console.log("  $ sol-msg subscribe -ch <channel_pda>");
    console.log('  $ sol-msg send-broadcast -ch <channel_pda> -m "New Update" -k channelkey');
    console.log("  $ sol-msg read-broadcasts -ch <channel_pda> -k channelkey");
    console.log("  $ sol-msg close-channel -ch <channel_pda>");
    console.log("");
});
program.parse(process.argv);
if (!process.argv.slice(2).length) {
    program.outputHelp();
}
//# sourceMappingURL=index.js.map