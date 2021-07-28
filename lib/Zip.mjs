// Uncompressed ZIP writer
// Dan Jackson, 2019
//
// This API and choice of ZIP arrangement (data descriptor/extended local header) is chosen so the file can be created 
// in chunks without prior knowledge of the length of each section and no backwards seeking required (e.g. if streamed).
// This interface also supports file alignment by using the "extra field" (not sure if standard, perhaps use comments instead?)
//

// Node shim
if (typeof TextEncoder === 'undefined') {
  global.TextEncoder = class TextEncoder {
    encode(string) { return Buffer.alloc(string.length, string).buffer; }
  }
}


export default class Zip {
  static dateTimeComponents(year, month, day, hours, minutes, seconds) {
    return (((year - 1980) & 0x7f) << 25) | ((month & 0x0f) << 21) | ((day & 0x1f) << 16) | ((hours & 0x1f) << 11) | ((minutes & 0x3f) << 5) | (seconds & 0x3f);
  }
  static dateTime(date) {
    return Zip.dateTimeComponents(date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds());
  }
  static dateTimeUTC(date) {
    return Zip.dateTimeComponents(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds());
  }

  // Based on an implementation by Rich Geldreich <richgel99@gmail.com> from miniz.c (public domain zlib-subset - "This is free and unencumbered software released into the public domain") 
  // which is an implementation of Karl Malbrain's compact CRC-32. See "A compact CCITT crc16 and crc32 C implementation that balances processor cache usage against speed": http://www.geocities.com/malbrain/
  static crc32(crc, arrayBuffer, length, offset)
  {
    const s_crc32 = [ 0, 0x1db71064, 0x3b6e20c8, 0x26d930ac, 0x76dc4190, 0x6b6b51f4, 0x4db26158, 0x5005713c, 0xedb88320, 0xf00f9344, 0xd6d6a3e8, 0xcb61b38c, 0x9b64c2b0, 0x86d3d2d4, 0xa00ae278, 0xbdbdf21c ];
    if (typeof length === 'undefined') { length = arrayBuffer.byteLength; }
    if (typeof offset === 'undefined') { offset = 0; }
    const typedArray = new Uint8Array(arrayBuffer, offset, length);
    crc = (~crc) & 0xffffffff;
    for (let i = 0; i < length; i++)
    {
      const b = typedArray[i];
      crc = (crc >>> 4) ^ s_crc32[(crc & 0xF) ^ (b & 0xF)];
      crc = (crc >>> 4) ^ s_crc32[(crc & 0xF) ^ (b >> 4)];
    }
    return (~crc) & 0xffffffff;
  }

  static concatArrayBuffers(buffers) {
    let length = 0;
    for (let buffer of buffers) {
      length += buffer.byteLength;
    }
    const concat = new Uint8Array(length);
    let offset = 0;
    for (let buffer of buffers) {
      concat.set(new Uint8Array(buffer), offset);
      offset += buffer.byteLength;
    }
    return concat.buffer;
  }

  /*
  // String using ASCII (or ISO-8859-1 or partially Windows-1252) to ArrayBuffer
  static asciiBuffer(string) {
    const charArray = new Uint8Array(string.length);
    for (let i = 0; i < string.length; i++) {
      charArray[i] = (string.charCodeAt(i) & 0xff);
    }
    return charArray;
  }
  */

  constructor() {
    this.initialize();
  }

  // Reset the zip writer state
  initialize() {
    this.length = 0;				// overall ZIP file length
    this.files = [];
    this.inFile = false;    // inside a file (otherwise before or between files)
    this.centralDirectoryEntries = 0;
    this.centralDirectoryOffset = null;
    this.centralDirectorySize = 0;
    this.chunks = [];
  }

  // Generate a ZIP local header for a file (before each file content) (the central directory entry is written later)
  startFile(filenameString, fileOptions) {
    if (this.inFile) {
      throw new Error('ZIP: Trying to start a new file when already within a file.');
    }
    if (this.centralDirectoryOffset !== null) {
      throw new Error('ZIP: Trying to start a file after the central directory has been started.');
    }

    const options = Object.assign({
      modified: new Date(),
      alignment: 0,
    }, fileOptions || {}); 
    let filenameBuffer;
    //filenameBuffer = Zip.asciiBuffer(filenameString);
    filenameBuffer = (new TextEncoder('utf-8')).encode(filenameString);
    const file = {
      filename: new Uint8Array(filenameBuffer),
      offset: this.length,
      modified: Zip.dateTime(options.modified),
      length: 0,
      extraFieldLength: 0,
      crc: Zip.CRC32_INIT,
    };
    // Calculate extra field length to match alignment
    if (options.alignment > 0) {
      const contentOffset = file.offset + 30 + file.filename.byteLength;
      const alignedOffset = (((contentOffset + options.alignment - 1) / options.alignment) | 0) * options.alignment;
      if (contentOffset != alignedOffset)
      {
        file.extraFieldLength = alignedOffset - contentOffset;
      }
    }

    const buffer = new ArrayBuffer(30 + file.filename.byteLength + file.extraFieldLength)
    const view = new DataView(buffer)

    view.setUint32( 0, 0x04034b50, true);                       // Local file header signature
    view.setUint16( 4, 0x14, true);                             // Version needed to extract
    view.setUint16( 6, 0x00 | (1 << 3) | (1 << 11), true);      // Flags (b3 = data descriptor, b11 = Unicode filename)
    view.setUint16( 8, 0x00, true);                             // Compression method (0=store, 8=deflated)
    view.setUint32(10, file.modified, true);                    // Modification date/time
    view.setUint32(14, file.crc, true);                         // CRC32
    view.setUint32(18, file.length, true);                      // Compressed size
    view.setUint32(22, file.length, true);                      // Uncompressed size
    view.setUint16(26, file.filename.byteLength, true);         // Filename length
    view.setUint16(28, file.extraFieldLength, true);            // Extra field length
    for (let i = 0; i < file.filename.byteLength; i++) {
      view.setUint8(30 + i, file.filename[i]);                  // Filename
    }
    for (let i = 0; i < file.extraFieldLength; i++) {
      view.setUint8(30 + file.filename.byteLength + i, 0);      // Extra field (padding)
    }

    this.length += buffer.byteLength;

    this.files.push(file);
    this.inFile = true;

    return buffer;
  }

  // Update the context with the ZIP file data
  fileContent(data, length, offset)
  {
    if (!this.inFile) {
      throw new Error('ZIP: Trying to process file content when not within a file.');
    }
    // If a String, convert
    if (!(data instanceof ArrayBuffer)) {
      data = (new TextEncoder('utf-8')).encode(data);
    }
    const file = this.files[this.files.length - 1];
    if (typeof length === 'undefined') { length = data.byteLength; }
    if (typeof offset === 'undefined') { offset = 0; }
    file.crc = Zip.crc32(file.crc, data, length, offset);
    // Update file and archive lengths
    file.length += length;
    this.length += length;
    return data;
  }

  // Generate the ZIP local header for a file
  endFile()
  {
    if (!this.inFile) {
      throw new Error('ZIP: Trying to end a file while not within a file.');
    }

    const file = this.files[this.files.length - 1];
    const buffer = new ArrayBuffer(16)
    const view = new DataView(buffer)

    // Extended local header
    view.setUint32( 0, 0x08074b50, true);                       // Extended local file header signature
    view.setUint32( 4, file.crc, true);                         // CRC32
    view.setUint32( 8, file.length, true);                      // Compressed size
    view.setUint32(12, file.length, true);                      // Uncompressed size

    this.length += buffer.byteLength;

    this.inFile = false;

    return buffer;
  }

  // Generate (the next) ZIP central directory entry
  centralDirectoryEntry()
  {
    if (this.inFile) {
      throw new Error('ZIP: Trying to add a central directory entry while still within a file.');
    }

    // Is this the start of the central directory?
    if (this.centralDirectoryOffset === null)
    {
      this.centralDirectoryOffset = this.length;
    }

    // Are there any remaining entries?
    if (this.centralDirectoryEntries >= this.files.length) {
      return null;
    }

    // Starting this entry
    const file = this.files[this.centralDirectoryEntries];

    // Central directory
    const buffer = new ArrayBuffer(46 + file.filename.byteLength + file.extraFieldLength)
    const view = new DataView(buffer)

    view.setUint32( 0, 0x02014b50, true);                       // Central directory
    view.setUint16( 4, 0x14, true);                             // Version made by
    view.setUint16( 6, 0x14, true);                             // Version needed to extract
    view.setUint16( 8, 0x00 | (1 << 3) | (1 << 11), true);      // Flags (b3 = data descriptor, b11 = Unicode filename)
    view.setUint16(10, 0x00, true);                             // Compression method (0=store, 8=deflated)
    view.setUint32(12, file.modified, true);                    // Modification date/time
    view.setUint32(16, file.crc, true);                         // CRC32
    view.setUint32(20, file.length, true);                      // Compressed size
    view.setUint32(24, file.length, true);                      // Uncompressed size
    view.setUint16(28, file.filename.byteLength, true);         // Filename length
    view.setUint16(30, file.extraFieldLength, true);            // Extra field length
    view.setUint16(32, 0, true);                                // File comment length
    view.setUint16(34, 0, true);                                // Disk number start
    view.setUint16(36, 0, true);                                // Internal file attributes
    view.setUint32(38, 0, true);                                // External file attributes
    view.setUint32(42, file.offset, true);                      // Relative offset of local header
    for (let i = 0; i < file.filename.byteLength; i++) {
      view.setUint8(46 + i, file.filename[i]);                  // Filename
    }
    for (let i = 0; i < file.extraFieldLength; i++) {
      view.setUint8(46 + file.filename.byteLength + i, 0);      // Extra field (padding)
    }

    this.length += buffer.byteLength;
    this.centralDirectorySize += buffer.byteLength;

    // Advance to the next entry
    this.centralDirectoryEntries++;

    return buffer;
  }

  // Generate the ZIP central directory end
  centralDirectoryEnd() {
    if (this.inFile) {
      throw new Error('ZIP: Trying to end a central directory when still within a file.');
    }
    if (this.centralDirectoryOffset === null) {
      throw new Error('ZIP: Trying to end a central directory when not processed any central directory entries.');
    }
    if (this.centralDirectoryEntries != this.files.length) {
      throw new Error('ZIP: Trying to end a central directory when not processed all of the central directory entries.');
    }

    const buffer = new ArrayBuffer(22)
    const view = new DataView(buffer)

    // Local header
    view.setUint32( 0, 0x06054b50, true);                       // End of central directory header
    view.setUint16( 4, 0, true);                                // Number of this disk
    view.setUint16( 6, 0, true);                                // Number of the disk with the start of the central directory
    view.setUint16( 8, this.centralDirectoryEntries, true);     // Number of entries in the central directory on this disk
    view.setUint16(10, this.centralDirectoryEntries, true);     // Total number of entries in the central directory
    view.setUint32(12, this.centralDirectorySize, true);        // Size of the central directory
    view.setUint32(16, this.centralDirectoryOffset, true);      // Offset of the start of the central directory from the starting disk
    view.setUint16(20, 0, true);                                // ZIP file comment length
    
    this.length += buffer.byteLength;
    return buffer;
  }

  addFile(filename, dataArray, fileOptions) {
    // Normalize data to an array
    if (!Array.isArray(dataArray)) {
      dataArray = [dataArray];
    }
    this.chunks.push(this.startFile(filename, fileOptions));
    for (let data of dataArray) {
      this.chunks.push(this.fileContent(data));
    }
    this.chunks.push(this.endFile());
  }

  getContent() {
    let created = false;
    let entry;
    while ((entry = this.centralDirectoryEntry()) !== null) {
      this.chunks.push(entry);
      created = true;
    }
    if (created) {
      this.chunks.push(this.centralDirectoryEnd());
    }
    return this.chunks;
  }

  getContentSingleBuffer() {
    return Zip.concatArrayBuffers(this.getContent());
  }

  getContentAsBlob() {
    return new Blob(this.getContent(), {type: 'application/octet-binary'});
  }

}
Zip.CRC32_INIT = 0;

/*
// node --experimental-modules lib/Zip.mjs
if (typeof window === 'undefined') {
  (async ()=>{
    const fs = await import('fs');
    const zip = new Zip();
    zip.addFile('TEST.TXT', 'Hello World!');
    const file = zip.getContentSingleBuffer();
    fs.writeFileSync('test.zip', Buffer.from(file));
  })();
}
*/
