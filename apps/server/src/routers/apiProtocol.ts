export function encodeApiSentence(words: readonly string[]) {
  return Buffer.concat([
    ...words.map((word) => {
      const data = Buffer.from(word);
      const n = data.length;
      if (n > 1024 * 1024) throw new Error("API word exceeds limit");
      const prefix =
        n < 0x80
          ? [n]
          : n < 0x4000
            ? [(n >> 8) | 0x80, n & 255]
            : n < 0x200000
              ? [(n >> 16) | 0xc0, (n >> 8) & 255, n & 255]
              : [(n >> 24) | 0xe0, (n >> 16) & 255, (n >> 8) & 255, n & 255];
      return Buffer.concat([Buffer.from(prefix), data]);
    }),
    Buffer.from([0]),
  ]);
}

export class ApiDecoder {
  private buffer: Buffer = Buffer.alloc(0);
  private words: string[] = [];
  private sentenceBytes = 0;
  push(chunk: Buffer, receive: (words: readonly string[]) => void) {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    let offset = 0;
    while (offset < this.buffer.length) {
      const first = this.buffer[offset]!;
      const bytes =
        first < 0x80
          ? 1
          : first < 0xc0
            ? 2
            : first < 0xe0
              ? 3
              : first < 0xf0
                ? 4
                : first === 0xf0
                  ? 5
                  : 0;
      if (!bytes) throw new Error("Reserved API control byte");
      if (this.buffer.length - offset < bytes) break;
      let length =
        bytes === 5 ? 0 : first & (bytes === 1 ? 127 : bytes === 2 ? 63 : bytes === 3 ? 31 : 15);
      for (let i = 1; i < bytes; i++) length = length * 256 + this.buffer[offset + i]!;
      if (length > 1024 * 1024) throw new Error("API word exceeds limit");
      if (this.buffer.length - offset < bytes + length) break;
      offset += bytes;
      if (length === 0) {
        const sentence = this.words;
        this.words = [];
        this.sentenceBytes = 0;
        receive(sentence);
      } else {
        this.sentenceBytes += length;
        if (this.sentenceBytes > 2 * 1024 * 1024 || this.words.length >= 256)
          throw new Error("API sentence exceeds limit");
        this.words.push(this.buffer.subarray(offset, offset + length).toString("utf8"));
      }
      offset += length;
    }
    this.buffer = this.buffer.subarray(offset);
  }
}

export function apiAttributes(words: readonly string[]) {
  const record: Record<string, string> = {};
  for (const word of words) {
    if (!word.startsWith("=")) continue;
    const end = word.indexOf("=", 1);
    if (end > 1) record[word.slice(1, end)] = word.slice(end + 1);
  }
  return record;
}
