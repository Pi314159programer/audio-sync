/**
 * Luby Transform (LT Code) Fountain Encoder & Decoder for Air-Gapped Optical Dynamic QR File Transfer
 */

/**
 * Robust Soliton Distribution helper to choose droplet degree
 * @param {number} K Total number of source blocks
 * @returns {number} Degree d (1 <= d <= K)
 */
function sampleSolitonDegree(K) {
  if (K <= 1) return 1;
  const rand = Math.random();
  // Ideal / Robust Soliton distribution approximation for QR packet sizes
  if (rand < 0.25) return 1;
  if (rand < 0.60) return 2;
  if (rand < 0.80) return 3;
  if (rand < 0.92) return Math.min(K, 4 + Math.floor(Math.random() * 2));
  return Math.min(K, 6 + Math.floor(Math.random() * (K - 6 > 0 ? K - 6 : 1)));
}

/**
 * Pseudo-random selection of 'degree' distinct indices from 0..K-1 using a seed
 */
function getIndicesFromSeed(seed, degree, K) {
  const indices = new Set();
  let currentSeed = seed;
  // Simple LCG pseudo-random generator
  const lcg = () => {
    currentSeed = (currentSeed * 1664525 + 1013904223) % 4294967296;
    return currentSeed / 4294967296;
  };

  while (indices.size < Math.min(degree, K)) {
    const idx = Math.floor(lcg() * K);
    indices.add(idx);
  }
  return Array.from(indices);
}

/**
 * LT Fountain Encoder
 * Encodes an ArrayBuffer into an infinite stream of XOR droplet packets
 */
export class FountainEncoder {
  /**
   * @param {ArrayBuffer} fileBuffer Original file data
   * @param {string} fileName Original file name
   * @param {string} mimeType Original file mime type
   * @param {number} [blockSize=250] Block size in bytes
   */
  constructor(fileBuffer, fileName = 'audio.mp3', mimeType = 'audio/mp3', blockSize = 250) {
    this.fileBuffer = fileBuffer;
    this.fileName = fileName;
    this.mimeType = mimeType;
    this.blockSize = blockSize;
    this.totalSize = fileBuffer.byteLength;

    const u8 = new Uint8Array(fileBuffer);
    this.totalBlocks = Math.ceil(this.totalSize / blockSize);
    this.blocks = [];

    for (let i = 0; i < this.totalBlocks; i++) {
      const block = new Uint8Array(blockSize);
      const start = i * blockSize;
      const end = Math.min(this.totalSize, start + blockSize);
      block.set(u8.subarray(start, end));
      this.blocks.push(block);
    }

    this.seqCounter = 0;
  }

  /**
   * Generate next droplet packet
   * @returns {Object} Droplet JSON payload object
   */
  nextDroplet() {
    this.seqCounter++;
    const K = this.totalBlocks;
    const degree = sampleSolitonDegree(K);
    const seed = (this.seqCounter * 2654435761 + Math.floor(Math.random() * 10000)) % 4294967296;
    const indices = getIndicesFromSeed(seed, degree, K);

    // XOR blocks together
    const xorData = new Uint8Array(this.blockSize);
    indices.forEach(idx => {
      const srcBlock = this.blocks[idx];
      for (let b = 0; b < this.blockSize; b++) {
        xorData[b] ^= srcBlock[b];
      }
    });

    // Convert XOR payload to compact Base64
    let binaryStr = '';
    for (let b = 0; b < this.blockSize; b++) {
      binaryStr += String.fromCharCode(xorData[b]);
    }
    const b64Data = btoa(binaryStr);

    return {
      k: K,
      b: this.blockSize,
      s: this.totalSize,
      i: seed,
      d: degree,
      data: b64Data,
      name: this.fileName,
      type: this.mimeType
    };
  }
}

/**
 * LT Fountain Decoder
 * Receives droplets in any order and reconstructs original ArrayBuffer using Belief Propagation
 */
export class FountainDecoder {
  constructor() {
    this.reset();
  }

  reset() {
    this.isInitialized = false;
    this.totalBlocks = 0;
    this.blockSize = 0;
    this.totalSize = 0;
    this.fileName = 'audio.mp3';
    this.mimeType = 'audio/mp3';

    this.resolvedBlocks = []; // Uint8Array or null
    this.resolvedCount = 0;
    this.receivedDroplets = []; // Array of { degree, indices, data: Uint8Array }
    this.processedSeeds = new Set();
  }

  /**
   * Add a decoded droplet packet
   * @param {Object} droplet
   * @returns {{ resolvedCount: number, totalBlocks: number, percent: number, isComplete: boolean }}
   */
  addDroplet(droplet) {
    if (!droplet || !droplet.k || !droplet.data) {
      return this.getStatus();
    }

    if (!this.isInitialized) {
      this.totalBlocks = droplet.k;
      this.blockSize = droplet.b || 250;
      this.totalSize = droplet.s || (this.totalBlocks * this.blockSize);
      this.fileName = droplet.name || 'audio.mp3';
      this.mimeType = droplet.type || 'audio/mp3';

      this.resolvedBlocks = new Array(this.totalBlocks).fill(null);
      this.resolvedCount = 0;
      this.isInitialized = true;
    }

    // Ignore duplicate droplets by seed
    if (this.processedSeeds.has(droplet.i)) {
      return this.getStatus();
    }
    this.processedSeeds.add(droplet.i);

    // Convert Base64 data back to Uint8Array
    const binaryStr = atob(droplet.data);
    const dataU8 = new Uint8Array(this.blockSize);
    for (let b = 0; b < binaryStr.length; b++) {
      dataU8[b] = binaryStr.charCodeAt(b);
    }

    const indices = getIndicesFromSeed(droplet.i, droplet.d, this.totalBlocks);

    // Create droplet entry
    const newDroplet = {
      degree: indices.length,
      indices: new Set(indices),
      data: dataU8
    };

    // Simplify new droplet using already resolved blocks
    this.simplifyDroplet(newDroplet);

    if (newDroplet.indices.size > 0) {
      this.receivedDroplets.push(newDroplet);
    }

    // Cascade belief propagation solver
    this.propagateSolitaryBlocks();

    return this.getStatus();
  }

  simplifyDroplet(droplet) {
    const toRemove = [];
    droplet.indices.forEach(idx => {
      if (this.resolvedBlocks[idx] !== null) {
        toRemove.push(idx);
        const resolvedData = this.resolvedBlocks[idx];
        for (let b = 0; b < this.blockSize; b++) {
          droplet.data[b] ^= resolvedData[b];
        }
      }
    });

    toRemove.forEach(idx => droplet.indices.delete(idx));
    droplet.degree = droplet.indices.size;
  }

  propagateSolitaryBlocks() {
    let changed = true;
    while (changed) {
      changed = false;

      // Find any degree-1 droplet
      for (let i = 0; i < this.receivedDroplets.length; i++) {
        const drop = this.receivedDroplets[i];
        if (drop.indices.size === 1) {
          const idx = Array.from(drop.indices)[0];
          if (this.resolvedBlocks[idx] === null) {
            this.resolvedBlocks[idx] = drop.data;
            this.resolvedCount++;
            changed = true;
          }
          // Remove resolved droplet from pool
          this.receivedDroplets.splice(i, 1);
          i--;
        }
      }

      if (changed) {
        // Simplify all remaining droplets with newly resolved blocks
        this.receivedDroplets.forEach(drop => this.simplifyDroplet(drop));
      }
    }
  }

  getStatus() {
    const total = this.totalBlocks || 1;
    const percent = Math.min(100, Math.floor((this.resolvedCount / total) * 100));
    return {
      resolvedCount: this.resolvedCount,
      totalBlocks: this.totalBlocks,
      percent: this.isInitialized ? percent : 0,
      isComplete: this.isInitialized && this.resolvedCount === this.totalBlocks
    };
  }

  /**
   * Reconstruct original file ArrayBuffer & Blob
   * @returns {{ buffer: ArrayBuffer, blob: Blob, fileName: string, mimeType: string }}
   */
  getReconstructedFile() {
    if (!this.getStatus().isComplete) return null;

    const fullBuffer = new Uint8Array(this.totalSize);
    for (let i = 0; i < this.totalBlocks; i++) {
      const block = this.resolvedBlocks[i];
      const start = i * this.blockSize;
      const end = Math.min(this.totalSize, start + this.blockSize);
      const len = end - start;
      fullBuffer.set(block.subarray(0, len), start);
    }

    const blob = new Blob([fullBuffer.buffer], { type: this.mimeType });
    return {
      buffer: fullBuffer.buffer,
      blob,
      fileName: this.fileName,
      mimeType: this.mimeType
    };
  }
}
