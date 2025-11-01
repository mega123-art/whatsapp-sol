#!/usr/bin/env node
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  SystemProgram,
} from "@solana/web3.js";
import { Command } from "commander";
import * as fs from "fs";
import * as crypto from "crypto";
import * as os from "os";
import * as path from "path";

// Using require for Chalk and Ora since they are common JS modules
const chalk = require("chalk");
const ora = require("ora");

// Program ID - MUST match the ID in your Anchor program
const PROGRAM_ID = new PublicKey(
  "9tN5NBvynubfJwQWDqrSoHEE3Xy2MVj3BmHdLu13wCcS"
);

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
function loadWallet(walletPath?: string): Keypair {
  const walletFile =
    walletPath || path.join(os.homedir(), ".config", "solana", "id.json");
  if (!fs.existsSync(walletFile)) {
    throw new Error(
      `Wallet file not found at ${walletFile}. Please specify --wallet path.`
    );
  }
  const secretKey = JSON.parse(fs.readFileSync(walletFile, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(secretKey));
}

/**
 * Creates a Connection object for the specified cluster.
 */
function createConnection(cluster: string): Connection {
  let url: string;
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
  return new Connection(url, "confirmed");
}

/**
 * Derives the Program Derived Address for a MessageThread.
 */
function deriveThreadPDA(
  participantA: PublicKey,
  participantB: PublicKey,
  threadId: Buffer
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("message_thread"),
      participantA.toBuffer(),
      participantB.toBuffer(),
      threadId,
    ],
    PROGRAM_ID
  );
}

/**
 * Derives the Program Derived Address for a BroadcastChannel.
 */
function deriveChannelPDA(
  owner: PublicKey,
  channelName: string
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("broadcast_channel"),
      owner.toBuffer(),
      Buffer.from(channelName),
    ],
    PROGRAM_ID
  );
}

/**
 * Derives the Program Derived Address for a ChannelSubscription.
 */
function deriveSubscriptionPDA(
  channel: PublicKey,
  subscriber: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("subscription"), channel.toBuffer(), subscriber.toBuffer()],
    PROGRAM_ID
  );
}

/**
 * Simple AES-256-CBC encryption for demo purposes.
 */
function encryptMessage(message: string, sharedSecret: string): Buffer {
  const cipher = crypto.createCipheriv(
    "aes-256-cbc",
    crypto.scryptSync(sharedSecret, "salt", 32),
    Buffer.alloc(16, 0)
  );
  return Buffer.concat([cipher.update(message, "utf8"), cipher.final()]);
}

/**
 * Simple AES-256-CBC decryption for demo purposes.
 */
function decryptMessage(encrypted: Buffer, sharedSecret: string): string {
  const decipher = crypto.createDecipheriv(
    "aes-256-cbc",
    crypto.scryptSync(sharedSecret, "salt", 32),
    Buffer.alloc(16, 0)
  );
  try {
    return Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString("utf8");
  } catch (e) {
    throw new Error("Decryption failed. Incorrect key or corrupt data.");
  }
}

// ============================================================================
// Internal Core Functions (Reusable by read/listen commands)
// ============================================================================

interface AccountMetadata {
  type: "thread" | "channel";
  pda: PublicKey;
  messageCountOffset: number;
  discriminator: Buffer;
  owner?: PublicKey;
  participantA?: PublicKey;
  participantB?: PublicKey;
  channelName?: string;
}

/**
 * Fetches and parses common metadata for a MessageThread or BroadcastChannel.
 */
async function _fetchAccountData(
  connection: Connection,
  pda: PublicKey,
  type: "thread" | "channel"
): Promise<{ info: AccountMetadata; data: Buffer }> {
  const accountInfo = await connection.getAccountInfo(pda);
  if (!accountInfo) {
    throw new Error(
      `${
        type === "thread" ? "Thread" : "Channel"
      } not found. Invalid PDA or account doesn't exist.`
    );
  }
  const data = accountInfo.data;
  const metadata: Partial<AccountMetadata> = { type, pda };

  if (type === "thread") {
    // MessageThread: 8 (disc) + 32 (A) + 32 (B) + 32 (ID) + 4 (count) = 108. Count is at 104.
    metadata.messageCountOffset = 104;
    metadata.discriminator = Buffer.from(DISCRIMINATORS.sendMessage, "hex");
    metadata.participantA = new PublicKey(data.slice(8, 40));
    metadata.participantB = new PublicKey(data.slice(40, 72));
  } else {
    // channel
    // BroadcastChannel: 8 (disc) + 32 (owner) + 4 (name len) + N (name) + 4 (count). Count is at 76 (assuming max 32 bytes for name)
    metadata.messageCountOffset = 76;
    metadata.discriminator = Buffer.from(DISCRIMINATORS.sendBroadcast, "hex");
    metadata.owner = new PublicKey(data.slice(8, 40));
    const channelNameLen = data.readUInt32LE(40);
    metadata.channelName = data.slice(44, 44 + channelNameLen).toString("utf8");
  }

  // Explicitly cast to AccountMetadata, assuming the type check above guarantees all fields are set
  return { info: metadata as AccountMetadata, data };
}

/**
 * Fetches and decrypts messages/broadcasts that have an index >= startingIndex.
 */
async function _fetchNewMessages(
  connection: Connection,
  metadata: AccountMetadata,
  sharedSecret: string,
  startingIndex: number = 0
): Promise<any[]> {
  const signatures = await connection.getSignaturesForAddress(metadata.pda, {
    limit: 1000,
  });

  const messages: any[] = [];
  const DISCRIMINATOR = metadata.discriminator;

  for (const sigInfo of signatures) {
    try {
      const tx = await connection.getTransaction(sigInfo.signature, {
        maxSupportedTransactionVersion: 0,
      });
      if (!tx || !tx.transaction) continue;

      const message = tx.transaction.message;
      if ("compiledInstructions" in message) {
        for (const ix of message.compiledInstructions) {
          const programId = message.staticAccountKeys[ix.programIdIndex];
          if (programId.equals(PROGRAM_ID)) {
            const ixData = Buffer.from(ix.data);

            // Check for discriminator
            if (
              ixData.length > 8 &&
              ixData.subarray(0, 8).equals(DISCRIMINATOR)
            ) {
              const messageIndex = ixData.readUInt32LE(8); // u32
              const contentLength = ixData.readUInt32LE(12); // u32
              const encrypted = ixData.slice(16, 16 + contentLength);

              // Only process messages that are new
              if (messageIndex >= startingIndex) {
                try {
                  const decrypted = decryptMessage(encrypted, sharedSecret);
                  // Sender is key 1 in the instruction's account list
                  const sender =
                    message.staticAccountKeys[ix.accountKeyIndexes[1]];

                  messages.push({
                    index: messageIndex,
                    sender: sender.toBase58(),
                    content: decrypted,
                    timestamp: tx.blockTime,
                    signature: sigInfo.signature,
                  });
                } catch (e) {
                  // Failed to decrypt message - skip and log if running a command that logs errors
                }
              }
            }
          }
        }
      }
    } catch (error) {
      // Skip transactions that failed to fetch or parse
    }
  }

  messages.sort((a, b) => a.index - b.index);
  return messages;
}

// ============================================================================
// Commands
// ============================================================================

/**
 * Initialize a new message thread between two participants.
 */
async function initThreadCommand(options: any) {
  console.log(chalk.bold.cyan("\n💬 Initialize Message Thread\n"));
  const spinner = ora();
  try {
    spinner.start("Loading wallet and connecting to Solana...");
    const wallet = loadWallet(options.wallet);
    const connection = createConnection(options.cluster);
    const participantB = new PublicKey(options.recipient);
    // Generate unique thread ID
    const threadId = crypto.randomBytes(32);
    const [threadPDA] = deriveThreadPDA(
      wallet.publicKey,
      participantB,
      threadId
    );
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
    const initIx = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: threadPDA, isSigner: false, isWritable: true },
        { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: participantB, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: initData,
    });
    const tx = new Transaction().add(initIx);
    const sig = await sendAndConfirmTransaction(connection, tx, [wallet], {
      commitment: "confirmed",
    });
    spinner.succeed(chalk.green(`Thread initialized!`));
    console.log(chalk.gray(`  Signature: ${sig}`));
    console.log(chalk.cyan(`\nThread PDA: ${threadPDA.toBase58()}\n`));
    console.log(
      chalk.gray(`Save this PDA to send and receive messages in this thread.`)
    );
    process.exit(0);
  } catch (error: any) {
    spinner.fail(chalk.red("Failed to initialize thread"));
    console.error(chalk.red(`\n❌ Error: ${error.message}`));
    process.exit(1);
  }
}

/**
 * Send a message in a message thread.
 */
async function sendMessageCommand(options: any) {
  console.log(chalk.bold.cyan("\n📤 Send Message\n"));
  const spinner = ora();
  try {
    spinner.start("Loading wallet and connecting to Solana...");
    const wallet = loadWallet(options.wallet);
    const connection = createConnection(options.cluster);
    const threadPDA = new PublicKey(options.thread);
    spinner.succeed(chalk.green(`Connected to ${options.cluster}`));
    console.log(chalk.gray(`  Thread: ${threadPDA.toBase58()}\n`));

    // Get thread info to determine next message index
    spinner.start("Fetching thread information...");
    const { info: metadata, data: accountData } = await _fetchAccountData(
      connection,
      threadPDA,
      "thread"
    );
    const messageCount = accountData.readUInt32LE(metadata.messageCountOffset);

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
    const sendIx = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: threadPDA, isSigner: false, isWritable: true },
        { pubkey: wallet.publicKey, isSigner: true, isWritable: false },
      ],
      data: messageData,
    });
    const tx = new Transaction().add(sendIx);
    const sig = await sendAndConfirmTransaction(connection, tx, [wallet], {
      commitment: "confirmed",
    });
    spinner.succeed(chalk.green(`Message sent!`));
    console.log(chalk.gray(`  Signature: ${sig}`));
    console.log(chalk.gray(`  Message index: ${messageCount}\n`));
    process.exit(0);
  } catch (error: any) {
    spinner.fail(chalk.red("Failed to send message"));
    console.error(chalk.red(`\n❌ Error: ${error.message}`));
    process.exit(1);
  }
}

/**
 * Read and decrypt messages from a thread's transaction history.
 */
async function readMessagesCommand(options: any) {
  console.log(chalk.bold.cyan("\n📖 Read Messages (Direct Thread)\n"));
  const spinner = ora();
  try {
    spinner.start("Connecting to Solana...");
    const connection = createConnection(options.cluster);
    const threadPDA = new PublicKey(options.thread);
    const sharedSecret = options.key || "default-secret-key";

    spinner.succeed(chalk.green(`Connected to ${options.cluster}`));
    console.log(chalk.gray(`  Thread: ${threadPDA.toBase58()}\n`));

    spinner.start("Fetching thread metadata and messages...");
    const { info: metadata, data: accountData } = await _fetchAccountData(
      connection,
      threadPDA,
      "thread"
    );
    const messageCount = accountData.readUInt32LE(metadata.messageCountOffset);

    const messages = await _fetchNewMessages(
      connection,
      metadata,
      sharedSecret,
      0
    );

    spinner.succeed(chalk.green(`Thread metadata retrieved`));
    console.log(
      chalk.gray(`  Participant A: ${metadata.participantA!.toBase58()}`)
    );
    console.log(
      chalk.gray(`  Participant B: ${metadata.participantB!.toBase58()}`)
    );
    console.log(chalk.gray(`  Total messages: ${messageCount}`));
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
  } catch (error: any) {
    spinner.fail(chalk.red("Failed to read messages"));
    console.error(chalk.red(`\n❌ Error: ${error.message}`));
    process.exit(1);
  }
}

/**
 * Initialize a new broadcast channel.
 */
async function createChannelCommand(options: any) {
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
    const initIx = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: channelPDA, isSigner: false, isWritable: true },
        { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: initData,
    });
    const tx = new Transaction().add(initIx);
    const sig = await sendAndConfirmTransaction(connection, tx, [wallet], {
      commitment: "confirmed",
    });
    spinner.succeed(chalk.green(`Channel created!`));
    console.log(chalk.gray(`  Signature: ${sig}`));
    console.log(chalk.cyan(`\nChannel PDA: ${channelPDA.toBase58()}\n`));
    console.log(chalk.gray(`Share this PDA with users who want to subscribe.`));
    process.exit(0);
  } catch (error: any) {
    spinner.fail(chalk.red("Failed to create channel"));
    console.error(chalk.red(`\n❌ Error: ${error.message}`));
    process.exit(1);
  }
}

/**
 * Send a broadcast message to a channel.
 */
async function sendBroadcastCommand(options: any) {
  console.log(chalk.bold.cyan("\n📡 Send Broadcast Message\n"));
  const spinner = ora();
  try {
    spinner.start("Loading wallet and connecting to Solana...");
    const wallet = loadWallet(options.wallet);
    const connection = createConnection(options.cluster);
    const channelPDA = new PublicKey(options.channel);
    spinner.succeed(chalk.green(`Connected to ${options.cluster}`));
    console.log(chalk.gray(`  Channel: ${channelPDA.toBase58()}\n`));

    // Get channel info to determine next message index
    spinner.start("Fetching channel information...");
    const { info: metadata, data: accountData } = await _fetchAccountData(
      connection,
      channelPDA,
      "channel"
    );
    const messageCount = accountData.readUInt32LE(metadata.messageCountOffset);

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
    const sendIx = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: channelPDA, isSigner: false, isWritable: true },
        { pubkey: wallet.publicKey, isSigner: true, isWritable: false }, // Sender is the channel owner
      ],
      data: broadcastData,
    });
    const tx = new Transaction().add(sendIx);
    const sig = await sendAndConfirmTransaction(connection, tx, [wallet], {
      commitment: "confirmed",
    });
    spinner.succeed(chalk.green(`Broadcast sent!`));
    console.log(chalk.gray(`  Signature: ${sig}`));
    console.log(chalk.gray(`  Message index: ${messageCount}\n`));
    process.exit(0);
  } catch (error: any) {
    spinner.fail(chalk.red("Failed to send broadcast"));
    console.error(chalk.red(`\n❌ Error: ${error.message}`));
    process.exit(1);
  }
}

/**
 * Subscribe to a broadcast channel.
 */
async function subscribeChannelCommand(options: any) {
  console.log(chalk.bold.cyan("\n➕ Subscribe to Channel\n"));
  const spinner = ora();
  try {
    spinner.start("Loading wallet and connecting to Solana...");
    const wallet = loadWallet(options.wallet);
    const connection = createConnection(options.cluster);
    const channelPDA = new PublicKey(options.channel);
    const [subscriptionPDA] = deriveSubscriptionPDA(
      channelPDA,
      wallet.publicKey
    );
    spinner.succeed(chalk.green(`Connected to ${options.cluster}`));
    console.log(chalk.gray(`  Subscriber: ${wallet.publicKey.toBase58()}`));
    console.log(chalk.gray(`  Channel: ${channelPDA.toBase58()}`));
    console.log(
      chalk.gray(`  Subscription PDA: ${subscriptionPDA.toBase58()}\n`)
    );

    spinner.start("Creating subscription account...");
    // Build subscribe instruction
    const subscribeData = Buffer.from(DISCRIMINATORS.subscribeChannel, "hex");

    const subscribeIx = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: subscriptionPDA, isSigner: false, isWritable: true }, // subscription PDA (init)
        { pubkey: channelPDA, isSigner: false, isWritable: true }, // broadcast_channel (mut)
        { pubkey: wallet.publicKey, isSigner: true, isWritable: true }, // subscriber (signer, mut, payer)
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: subscribeData,
    });
    const tx = new Transaction().add(subscribeIx);
    const sig = await sendAndConfirmTransaction(connection, tx, [wallet], {
      commitment: "confirmed",
    });
    spinner.succeed(chalk.green(`Subscription successful!`));
    console.log(chalk.gray(`  Signature: ${sig}`));
    console.log(
      chalk.cyan(`\nSubscription PDA: ${subscriptionPDA.toBase58()}\n`)
    );
    process.exit(0);
  } catch (error: any) {
    spinner.fail(chalk.red("Failed to subscribe to channel"));
    console.error(chalk.red(`\n❌ Error: ${error.message}`));
    process.exit(1);
  }
}

/**
 * Read and decrypt messages from a broadcast channel's transaction history.
 */
async function readBroadcastsCommand(options: any) {
  console.log(chalk.bold.cyan("\n📡 Read Broadcast Messages\n"));
  const spinner = ora();
  try {
    spinner.start("Connecting to Solana...");
    const connection = createConnection(options.cluster);
    const channelPDA = new PublicKey(options.channel);
    const sharedSecret = options.key || "default-channel-key";

    spinner.succeed(chalk.green(`Connected to ${options.cluster}`));
    console.log(chalk.gray(`  Channel: ${channelPDA.toBase58()}\n`));

    // Fetch channel metadata
    spinner.start("Fetching channel metadata and messages...");
    const { info: metadata, data: accountData } = await _fetchAccountData(
      connection,
      channelPDA,
      "channel"
    );
    const messageCount = accountData.readUInt32LE(metadata.messageCountOffset);

    const messages = await _fetchNewMessages(
      connection,
      metadata,
      sharedSecret,
      0
    );

    spinner.succeed(chalk.green(`Channel metadata retrieved`));
    console.log(chalk.gray(`  Owner: ${metadata.owner!.toBase58()}`));
    console.log(chalk.gray(`  Channel Name: ${metadata.channelName}`));
    console.log(chalk.gray(`  Total broadcasts: ${messageCount}`));
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
  } catch (error: any) {
    spinner.fail(chalk.red("Failed to read broadcasts"));
    console.error(chalk.red(`\n❌ Error: ${error.message}`));
    process.exit(1);
  }
}

/**
 * Close a message thread and refund rent.
 */
async function closeThreadCommand(options: any) {
  console.log(chalk.bold.cyan("\n🗑️ Close Message Thread\n"));
  const spinner = ora();
  try {
    spinner.start("Loading wallet and connecting to Solana...");
    const wallet = loadWallet(options.wallet);
    const connection = createConnection(options.cluster);
    const threadPDA = new PublicKey(options.thread);
    const recipient = new PublicKey(options.recipient || wallet.publicKey); // Default refund to self

    spinner.succeed(chalk.green(`Connected to ${options.cluster}`));
    console.log(
      chalk.gray(`  Signer (Participant A): ${wallet.publicKey.toBase58()}`)
    );
    console.log(chalk.gray(`  Thread: ${threadPDA.toBase58()}`));
    console.log(chalk.gray(`  Recipient (Refund): ${recipient.toBase58()}\n`));

    spinner.start("Closing thread and refunding rent...");
    // Build close instruction
    const closeData = Buffer.from(DISCRIMINATORS.closeThread, "hex");

    const closeIx = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: threadPDA, isSigner: false, isWritable: true },
        { pubkey: wallet.publicKey, isSigner: true, isWritable: false }, // participant_a
        { pubkey: recipient, isSigner: false, isWritable: true }, // recipient (mut)
      ],
      data: closeData,
    });
    const tx = new Transaction().add(closeIx);
    const sig = await sendAndConfirmTransaction(connection, tx, [wallet], {
      commitment: "confirmed",
    });
    spinner.succeed(chalk.green(`Thread closed successfully!`));
    console.log(chalk.gray(`  Signature: ${sig}`));
    process.exit(0);
  } catch (error: any) {
    spinner.fail(chalk.red("Failed to close thread"));
    console.error(chalk.red(`\n❌ Error: ${error.message}`));
    process.exit(1);
  }
}

/**
 * Close a broadcast channel and refund rent.
 */
async function closeChannelCommand(options: any) {
  console.log(chalk.bold.cyan("\n🗑️ Close Broadcast Channel\n"));
  const spinner = ora();
  try {
    spinner.start("Loading wallet and connecting to Solana...");
    const wallet = loadWallet(options.wallet);
    const connection = createConnection(options.cluster);
    const channelPDA = new PublicKey(options.channel);
    const recipient = new PublicKey(options.recipient || wallet.publicKey); // Default refund to self

    spinner.succeed(chalk.green(`Connected to ${options.cluster}`));
    console.log(chalk.gray(`  Signer (Owner): ${wallet.publicKey.toBase58()}`));
    console.log(chalk.gray(`  Channel: ${channelPDA.toBase58()}`));
    console.log(chalk.gray(`  Recipient (Refund): ${recipient.toBase58()}\n`));

    spinner.start("Closing channel and refunding rent...");
    // Build close instruction
    const closeData = Buffer.from(DISCRIMINATORS.closeChannel, "hex");

    const closeIx = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: channelPDA, isSigner: false, isWritable: true },
        { pubkey: wallet.publicKey, isSigner: true, isWritable: false }, // owner
        { pubkey: recipient, isSigner: false, isWritable: true }, // recipient (mut)
      ],
      data: closeData,
    });
    const tx = new Transaction().add(closeIx);
    const sig = await sendAndConfirmTransaction(connection, tx, [wallet], {
      commitment: "confirmed",
    });
    spinner.succeed(chalk.green(`Channel closed successfully!`));
    console.log(chalk.gray(`  Signature: ${sig}`));
    process.exit(0);
  } catch (error: any) {
    spinner.fail(chalk.red("Failed to close channel"));
    console.error(chalk.red(`\n❌ Error: ${error.message}`));
    process.exit(1);
  }
}

/**
 * Monitors a PDA for changes and displays the new message content instantly.
 */
async function monitorPdaUpdates(options: any) {
  const accountAddress = options.thread || options.channel;
  const isThread = !!options.thread;

  if (!accountAddress) {
    console.error(
      chalk.red("\n❌ Error: Must provide a --thread or --channel address.")
    );
    process.exit(1);
  }

  if (!options.key) {
    console.warn(
      chalk.yellow(
        `\n⚠️ Warning: No encryption key (--key) provided. Messages will not be decrypted/displayed automatically.\n`
      )
    );
  }

  const targetPDA = new PublicKey(accountAddress);
  const sharedSecret = options.key || "default-secret-key";

  console.log(
    chalk.bold.cyan(
      isThread
        ? "\n👂 Listening for Thread Updates..."
        : "\n👂 Listening for Channel Broadcasts..."
    )
  );
  console.log(chalk.gray(`  Target PDA: ${targetPDA.toBase58()}`));
  console.log(chalk.gray(`  Cluster: ${options.cluster}`));
  console.log(
    chalk.gray(
      `  Decryption Key: ${options.key ? "Provided" : "Using default"}\n`
    )
  );

  const connection = createConnection(options.cluster);
  let initialCount = 0;

  try {
    // 1. Fetch initial state to get the current count and metadata
    const { info: metadata, data: accountData } = await _fetchAccountData(
      connection,
      targetPDA,
      isThread ? "thread" : "channel"
    );
    initialCount = accountData.readUInt32LE(metadata.messageCountOffset);

    console.log(
      chalk.green(`Initial message/broadcast count: ${initialCount}\n`)
    );

    // 2. Set up the WebSocket subscription
    const subscriptionId = connection.onAccountChange(
      targetPDA,
      async (updatedAccountInfo, context) => {
        const updatedData = updatedAccountInfo.data;
        const newCount = updatedData.readUInt32LE(metadata.messageCountOffset);

        if (newCount > initialCount) {
          const timestamp = new Date().toLocaleTimeString();
          console.log(
            chalk.yellow("==================================================")
          );
          console.log(
            chalk.green.bold(
              `\n🎉 New ${
                isThread ? "Message" : "Broadcast"
              } Received at ${timestamp}! (Slot: ${context.slot})`
            )
          );

          try {
            // Fetch and decrypt only the new message(s) by starting from the initial count
            const newMessages = await _fetchNewMessages(
              connection,
              metadata,
              sharedSecret,
              initialCount
            );

            if (newMessages.length > 0) {
              const latestMessage = newMessages[newMessages.length - 1];
              const msgType = isThread ? "Message" : "Broadcast";
              console.log(
                chalk.cyan(`[${latestMessage.index}] ${msgType} Content:`)
              );
              console.log(chalk.gray(`From: ${latestMessage.sender}`));
              console.log(chalk.white(`${latestMessage.content}\n`));
            } else {
              console.log(
                chalk.yellow(
                  `Could not find or decrypt new content. Run the 'sol-msg ${
                    isThread ? "read" : "read-broadcasts"
                  }' command for a full log (Old Count: ${initialCount} -> New Count: ${newCount}).`
                )
              );
            }
          } catch (e: any) {
            console.error(
              chalk.red(`\n❌ Decryption/Fetch Error: ${e.message}`)
            );
            console.log(
              chalk.yellow(
                `Run the 'sol-msg ${
                  isThread ? "read" : "read-broadcasts"
                }' command for a full log.`
              )
            );
          }

          console.log(
            chalk.yellow("==================================================\n")
          );
          initialCount = newCount; // Update the count for the next message
        }
      },
      "confirmed" // Commitment level
    );

    console.log(
      chalk.cyan(`Listening started. Subscription ID: ${subscriptionId}`)
    );
    console.log(chalk.gray("Press Ctrl+C to stop listening...\n"));

    // Keep the process alive
    process.stdin.resume();

    // Cleanup on exit
    process.on("SIGINT", async () => {
      console.log(chalk.yellow("\nStopping subscription..."));
      await connection.removeAccountChangeListener(subscriptionId);
      console.log(chalk.yellow("Subscription removed. Exiting."));
      process.exit(0);
    });
  } catch (error: any) {
    console.error(
      chalk.red(`\n❌ Error setting up listener: ${error.message}`)
    );
    process.exit(1);
  }
}

// ============================================================================
// CLI Setup
// ============================================================================
const program = new Command();

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
  .option(
    "-r, --recipient <address>",
    "Account to receive the rent refund (defaults to signer)"
  )
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
  .option(
    "-k, --key <secret>",
    "Encryption key (shared secret for all channel messages)"
  )
  .option("-w, --wallet <path>", "Path to wallet keypair file")
  .option("-c, --cluster <cluster>", "Solana cluster", "devnet")
  .action(sendBroadcastCommand);

// Read broadcasts
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
  .option(
    "-r, --recipient <address>",
    "Account to receive the rent refund (defaults to signer)"
  )
  .option("-w, --wallet <path>", "Path to wallet keypair file")
  .option("-c, --cluster <cluster>", "Solana cluster", "devnet")
  .action(closeChannelCommand);

// ------------------------------------
// REAL-TIME LISTENER COMMAND (UPDATED)
// ------------------------------------

program
  .command("listen")
  .description("Listen for real-time updates on a thread or channel PDA")
  .option("-t, --thread <address>", "Thread PDA address to listen to")
  .option("-ch, --channel <address>", "Channel PDA address to listen to")
  .option(
    "-k, --key <secret>",
    "Decryption key (REQUIRED for instant content display)"
  )
  .option("-c, --cluster <cluster>", "Solana cluster", "devnet")
  .action(monitorPdaUpdates);

// ------------------------------------
// HELP AND PARSE
// ------------------------------------

program.on("--help", () => {
  console.log("");
  console.log(chalk.bold("Examples:"));
  console.log(chalk.yellow("  --- Direct Messaging ---"));
  console.log("  $ sol-msg init-thread -r <recipient_pubkey> -c devnet");
  console.log(
    '  $ sol-msg send -t <thread_pda> -m "Hello!" -k mykey -c devnet'
  );
  console.log("  $ sol-msg read -t <thread_pda> -k mykey -c devnet");
  console.log("  $ sol-msg listen -t <thread_pda> -k mykey -c devnet");
  console.log("  $ sol-msg close-thread -t <thread_pda>");

  console.log(chalk.yellow("\n  --- Broadcast Channels ---"));
  console.log('  $ sol-msg create-channel -n "Announcements"');
  console.log("  $ sol-msg subscribe -ch <channel_pda>");
  console.log(
    '  $ sol-msg send-broadcast -ch <channel_pda> -m "New Update" -k channelkey'
  );
  console.log("  $ sol-msg read-broadcasts -ch <channel_pda> -k channelkey");
  console.log("  $ sol-msg listen -ch <channel_pda> -k channelkey -c devnet");
  console.log("  $ sol-msg close-channel -ch <channel_pda>");

  console.log("");
});

program.parse(process.argv);

if (!process.argv.slice(2).length) {
  program.outputHelp();
}
