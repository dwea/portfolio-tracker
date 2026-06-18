const NTFY_BASE = 'https://ntfy.sh';

export async function sendTextMessage(
  recipients: string[],
  message: string,
  testMode: boolean = false,
  log?: (msg: string) => Promise<void>
): Promise<void> {
  const logMsg = async (msg: string) => {
    if (log) {
      await log(msg);
    } else {
      console.log(msg);
    }
  };

  if (recipients.length === 0) {
    await logMsg('No recipients specified, skipping send');
    return;
  }

  if (testMode) {
    console.log('\n═══════════════════════════════════════');
    console.log('TEST MODE - Message Preview:');
    console.log('═══════════════════════════════════════');
    console.log(message);
    console.log('═══════════════════════════════════════');
    console.log(`Would send to ntfy topics: ${recipients.join(', ')}`);
    console.log('═══════════════════════════════════════\n');
    return;
  }

  // ntfy message limit is 4096 bytes. Split on line boundary if needed.
  const CHUNK_SIZE = 4000;
  const chunks: string[] = [];
  if (message.length <= CHUNK_SIZE) {
    chunks.push(message);
  } else {
    let remaining = message;
    while (remaining.length > CHUNK_SIZE) {
      let cutAt = remaining.lastIndexOf('\n', CHUNK_SIZE);
      if (cutAt <= 0) cutAt = CHUNK_SIZE;
      chunks.push(remaining.slice(0, cutAt).trimEnd());
      remaining = remaining.slice(cutAt).trimStart();
    }
    if (remaining.length > 0) chunks.push(remaining);
  }

  for (const topic of recipients) {
    try {
      for (let i = 0; i < chunks.length; i++) {
        const text = chunks.length > 1 ? `(${i + 1}/${chunks.length})\n${chunks[i]}` : chunks[i];
        const res = await fetch(`${NTFY_BASE}/${topic}`, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          body: text,
        });
        if (res.ok) {
          await logMsg(`✓ Sent to ntfy topic: ${topic}${chunks.length > 1 ? ` [part ${i + 1}/${chunks.length}]` : ''}`);
        } else {
          await logMsg(`✗ ntfy error for topic ${topic}: HTTP ${res.status}`);
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      await logMsg(`✗ Failed to send to topic ${topic}: ${errorMsg}`);
    }
  }
}

// Image sending not supported — sparkline is available in the editor preview only.
export async function sendImageMessage(_recipients: string[], _imagePath: string, _testMode: boolean = false): Promise<void> {
  // no-op
}
