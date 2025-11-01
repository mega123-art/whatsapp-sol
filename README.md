# Solana Messaging Protocol

A decentralized, encrypted messaging system built on Solana for direct peer-to-peer messaging and broadcast channels.

## Installation

```bash
npm install -g sol-msg
```

Or build from source:
```bash
git clone <repository>
cd cli
npm install
npm run build
npm link
```

## Quick Start

All commands use these common options:
- `--wallet, -w`: Path to wallet file (default: `~/.config/solana/id.json`)
- `--cluster, -c`: Solana cluster (default: `devnet`)
- `--key, -k`: Encryption key for messages

## Direct Messaging

### 1. Create a Thread
Start a private conversation with another user:

```bash
sol-msg init-thread --recipient <RECIPIENT_PUBKEY>
```

Save the **Thread PDA** address shown in the output.

### 2. Send a Message
```bash
sol-msg send \
  --thread <THREAD_PDA> \
  --message "Hello!" \
  --key "my-secret-key"
```

### 3. Read Messages
```bash
sol-msg read \
  --thread <THREAD_PDA> \
  --key "my-secret-key"
```

### 4. Listen for Real-Time Messages
Get notified instantly when new messages arrive:

```bash
sol-msg listen \
  --thread <THREAD_PDA> \
  --key "my-secret-key"
```

Press Ctrl+C to stop listening.

### 5. Close Thread
Delete the thread and get your rent back:

```bash
sol-msg close-thread --thread <THREAD_PDA>
```

## Broadcast Channels

### 1. Create a Channel
Start a one-to-many broadcast channel:

```bash
sol-msg create-channel --name "Announcements"
```

Save the **Channel PDA** address shown in the output.

### 2. Subscribe to a Channel
```bash
sol-msg subscribe --channel <CHANNEL_PDA>
```

### 3. Send a Broadcast (Owner Only)
```bash
sol-msg send-broadcast \
  --channel <CHANNEL_PDA> \
  --message "Important update!" \
  --key "channel-key"
```

### 4. Read Broadcasts
```bash
sol-msg read-broadcasts \
  --channel <CHANNEL_PDA> \
  --key "channel-key"
```

### 5. Listen for Real-Time Broadcasts
```bash
sol-msg listen \
  --channel <CHANNEL_PDA> \
  --key "channel-key"
```

### 6. Close Channel (Owner Only)
```bash
sol-msg close-channel --channel <CHANNEL_PDA>
```

## Complete Examples

### Direct Messaging Example
```bash
# Alice initializes a thread with Bob
sol-msg init-thread -r BobPublicKey123... -c devnet
# Output: Thread PDA: ThreadABC123...

# Alice sends a message
sol-msg send -t ThreadABC123... -m "Hi Bob!" -k "shared-secret" -c devnet

# Bob reads messages
sol-msg read -t ThreadABC123... -k "shared-secret" -c devnet

# Bob listens for new messages
sol-msg listen -t ThreadABC123... -k "shared-secret" -c devnet
```

### Broadcast Channel Example
```bash
# Create a channel
sol-msg create-channel -n "Daily News" -c devnet
# Output: Channel PDA: ChannelXYZ789...

# Users subscribe
sol-msg subscribe -ch ChannelXYZ789... -c devnet

# Owner broadcasts
sol-msg send-broadcast -ch ChannelXYZ789... -m "Breaking news!" -k "news-key" -c devnet

# Subscribers read
sol-msg read-broadcasts -ch ChannelXYZ789... -k "news-key" -c devnet

# Subscribers listen
sol-msg listen -ch ChannelXYZ789... -k "news-key" -c devnet
```

## Important Notes

🔐 **Encryption Keys**: Both participants must use the same encryption key. Share it securely outside of this system.

💰 **Costs**: Each operation costs a small transaction fee (~0.000005 SOL). Creating threads/channels requires rent (~0.002 SOL, refundable).

🌐 **Clusters**: 
- Use `devnet` for testing (free SOL from faucet)
- Use `mainnet-beta` for production
- Use `localhost` for local development

## All Commands

```
sol-msg init-thread          Create a message thread
sol-msg send                 Send a message
sol-msg read                 Read thread messages
sol-msg listen               Listen for new messages/broadcasts
sol-msg close-thread         Close thread and refund rent

sol-msg create-channel       Create a broadcast channel
sol-msg subscribe            Subscribe to a channel
sol-msg send-broadcast       Broadcast a message (owner only)
sol-msg read-broadcasts      Read channel broadcasts
sol-msg close-channel        Close channel and refund rent
```

## Get Help

```bash
sol-msg --help
sol-msg <command> --help
```
