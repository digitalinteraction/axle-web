import Command from './Command.mjs';
import { log } from './Utils.mjs';

export default class Streamer {
  constructor(device) {
    this.device = device;
    this.packetHandler = null;
    this.streamRate = 50;
    this.streamRange = 8;
    this.streamOptions = 0;
    this.packetCount = 0;
    this.sampleCount = 0;
    this.samples = [];
    this.firstTimestamp = null;
    this.firstTime = null;
    this.lastBattery = null;
    this.lastTemperature = null;
    this.lineHandler = (line) => {
      this.receiveLine(line);
    }
    this.device.setLineHandler(this.lineHandler);
    this.disconnectedHandler = (device) => {
      this.disconnected();
    }
    this.device.setDisconnectedHandler(this.disconnectedHandler);
    this.recordingName = '';
    this.newSamplesHandler = null;
    this.streaming = false;
    this.reconnectTimer = setInterval(async () => {
      if (this.streaming && !this.device.isConnected() && this.device.isConnecting()) {
        log('STREAMER: (...reconnecting ' + ((Date.now() - this.device.connecting)/1000|0) + '...)');
      }
      if (this.streaming && !this.device.isConnected() && !this.device.isConnecting()) {
        try {
          log('STREAMER: Reconnect...');
          await this.device.connect();
          await this.connected();
        } catch (e) {
          log('STREAMER: Reconnect failed: ' + e);
        }
      }
    }, 1000);
  }

  disconnected() {
    log('STREAMER: Disconnected.');
  }

  async connected() {
    log('STREAMER: Connected.');
    if (this.streaming) {
      try {
        await this.streamCommand(50, 8, 1);
      } catch (e) {
        log('STREAMER: Stream command failed, will disconnect and reconnect: ' + e);
        await this.device.disconnect();
      }
    }
  }

  async idCommand() {
    const command = new Command({command: '#', timeout: 3000, responsePrefix: ['#:', '?']});
    await command.exec(this.device);
    let id = null;
    for (let response of command.responses) {
      if (response.startsWith('#:')) {
        id = response.substr(2).trim().toUpperCase();
        if (id.length == 12) {
          id = id[0] + id[1] + ':' + id[2] + id[3] + ':' + id[4] + id[5] + ':' + id[6] + id[7] + ':' + id[8] + id[9] + ':' + id[10] + id[11];
        }
      }
    }
    return id;
  }

  async bootloadCommand() {
    // XD=Start Bootloader, XB=???, X!=Reset
    const command = new Command({command: 'XB', timeout: 3000, responsePrefix: ['!']});
    await command.exec(this.device);
    return true;
  }

  async motorCommand() {
    // 1=Motor output; M=Motor pulse
    const command = new Command({command: 'M', timeout: 3000, responsePrefix: ['MOT']});
    await command.exec(this.device);
    return true;
  }

  async ledGreenCommand() {
    // 2=LED2 output test, green
    const command = new Command({command: '2', timeout: 3000, responsePrefix: ['LED2']});
    await command.exec(this.device);
    return true;
  }

  async ledBlueCommand() {
    // 3=LED3 output test, blue
    const command = new Command({command: '3', timeout: 3000, responsePrefix: ['LED3']});
    await command.exec(this.device);
    return true;
  }

  async outputOffCommand() {
    // 0=Output off
    const command = new Command({command: '0', timeout: 3000, responsePrefix: ['OFF']});
    await command.exec(this.device);
    return true;
  }

  async streamCommand(requestedRate, requestedRange, requestedOptions) {
    // I - streaming
    const command = new Command({command: 'I ' + requestedRate + ' ' + requestedRange + ' ' + requestedOptions, timeout: 3000, responsePrefix: ['OP:']});
    await command.exec(this.device);
    for (let response of command.responses) {
      if (response.startsWith('OP:')) {
        const parts = response.split(',');
        if (parts.length > 1) { this.streamRate = parseInt(parts[1]); }
        if (parts.length > 2) { this.streamRange = parseInt(parts[2]); }
        if (parts.length > 3) { this.streamOptions = parseInt(parts[3]); }
      }
    }
  }

  deviceId() {
    return this.device.deviceId();
  }

  async initialConnect() {
    await this.device.connect();

// TODO: Remove this
//log('TEMPORARY Motor command...');
//await this.motorCommand();

    if (!this.device.id) {
      const id = await this.idCommand();
      if (id) {
        this.device.id = id;
      } else {
        log('WARNING: Id command not successful (unsupported?)');
      }
    }
    log('DEVICE-ID: ' + this.device.deviceId());
  }

  startStreaming() {
    // Reset timer (no long-term drift between recordings)
    //this.firstTimestamp = null;  // device timer
    //this.firstTime = null;      // milliseconds from epoch

    this.streaming = true;
    if (this.device.isConnected()) {
      (async () => {
        try {
          this.connected();
        } catch (e) { ; }   // any error will cause disconnect and will be retried in reconnect loop
      })();
    }
  }

  async stopStreaming() {
    this.streaming = false;
    if (this.device.isConnected()) {
      try {
        await this.outputOffCommand();
      } catch (e) {
        log('Error stopping stream, will disconnect: ' + e)
        this.device.disconnect();
      }
    }
  }

  static rawToBatteryVoltage(value) {
    // If top-six bits are zero (value < 1024): 000000rr rrrrrrrr -- r=10-bit ADC
    // If top-six bits are non-zero:  vvvvvvvv vppppppp -- p=7-bit percentage (127=unknown), v=9-bit voltage in units of 0.01V / 10mV (clamped 8-512, minimum to be unambiguously not a raw ADC).
    if (value >= 1024) {
      return (value >>> 7) * 10 / 1000;
    }
    const ref = 1.2;        // 1.2V
    const resolution = 10;  // 10-bit
    const scale = 1/3;      // divide-by-3 scale
    const battScale = 2;    // Battery is /2 before ADC, so must be doubled    
    let result = battScale * (ref / scale) * value / 2**resolution;
    result = Math.floor(result * 1000) / 1000;  // limit precision
    return result;
  }

  static rawToBatteryPercentage(sample) {
    // If top-six bits are zero (value < 1024): 000000rr rrrrrrrr -- r=10-bit ADC
    // If top-six bits are non-zero:  vvvvvvvv vppppppp -- p=7-bit percentage (127=unknown), v=9-bit voltage in units of 0.01V / 10mV (clamped 8-512, minimum to be unambiguously not a raw ADC).
    if (sample >= 1024) {
      return (sample & 0x7f);
    }
    // Battery capacity lookup table, 10bit ADC, 50% input divider, 33% scaler, and reference of 1200 mV
    const BATT_TABLE_OS = 471;  // Capacity = Table[(sample - 471)], for sample range 471 up to 590
    const battCapacity = [      // 120 samples
      2,	3,	3,	3,	3,	3,	3,	3,	3,	3,	3,	3,	3,	3,	3,	3,  3,	4,	4,	4,	4,	4,	4,	4,	4,	4,	4,	4,	5,	5,	5,	5,   
      5,	5,	5,	5,	6,	6,	6,	6,	6,	6,	7,	7,	7,	7,	8,	8,  10,	12,	13,	14,	16,	17,	18,	20,	22,	24,	27,	30,	33,	37,	40,	43,   
      45,	48,	50,	52,	54,	56,	57,	59,	60,	62,	63,	64,	65,	66,	68,	69, 70,	71,	72,	73,	74,	75,	76,	77,	78,	79,	80,	81,	82,	83,	84,	85,   
      86,	87,	87,	88,	89,	90,	90,	91,	92,	93,	94,	94,	95,	96,	96,	97, 97,	98,	98,	98,	99,	99,	99,	99,
    ];
    if (sample < BATT_TABLE_OS) return 0;
    if (sample - BATT_TABLE_OS >= battCapacity.length) return 100;
    return battCapacity[sample - BATT_TABLE_OS];
  }

  static rawToTemperatureCelsius(sample) {
    if ((sample & 0xffff) == 0xffff) return null;
    return sample / 4;
  }

  receiveLine(line) {
    const receivedTime = Date.now();
    let type = null;
    if (line.length > 0 && (line[0] == '!' || line[0] == '$' || line[0] == '#')) type = line[0];
    let startIndex = 0;
    if (type != null) startIndex = 1;
    let dataLength = line.length - startIndex;

    // Find out if the line is entirely a non-zero even number of hex characters
    let allHex = true;
    for (let i = 0; i < dataLength; i++) {
      let c = line.charCodeAt(startIndex + i);
      allHex &= (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x46) || (c >= 0x61 && c <= 0x66);
    }
    if (dataLength < 0 || dataLength % 2 != 0) allHex = false;

    // Base-16 decode the string: convert hex pairs to byte values
    let bytes = [];
    if (allHex) {
      for (let i = 0; i < dataLength; i += 2) {
        bytes.push(parseInt(line.substr(startIndex + i, 2), 16));
      }
    }

    // Decide if this is a streaming packet (>16 header hex-pairs, multiple of 12 hex-pairs for the samples)
    if (type == null && bytes.length >= 8 && (bytes.length - 8) % 6 == 0) { // in characters: 8+4+4+25*12+2=318, -2 CRLF = 316
      // Translate header into packet, number of samples from the packet length
      // TODO: Use DataView instead?
      let packet = {
        received: receivedTime,
        timestamp: bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24),  // 1/32768 second
        battRaw: bytes[4] | (bytes[5] << 8),
        tempRaw: bytes[6] | (bytes[7] << 8),
        samples: new Array(Math.floor((bytes.length - 8) / 6)),
      }

// Limit to least-significant 24-bits for backwards compatibility
packet.timestamp = packet.timestamp & 0x00ffffff;

      if (packet.tempRaw >= 32768) packet.tempRaw -= 65536;   // 16-bit signed value
      if (packet.samples.length != 25) {
        // Don't use the small packets
        if (packet.samples.length <= 1) {
          log('WARNING: Non-standard packet size received (' + packet.samples.length + ') -- will not use it.')
          return;
        } else {
          log('WARNING: Non-standard packet size received (' + packet.samples.length + ') -- will still use it.')
        }
      }
      for (let i = 0; i < packet.samples.length; i++) {
        let j = 8 + 6 * i;
        packet.samples[i] = [];
        packet.samples[i][0] = bytes[j + 0] | (bytes[j + 1] << 8);
        if (packet.samples[i][0] >= 0x8000) packet.samples[i][0] -= 0x10000;
        packet.samples[i][1] = bytes[j + 2] | (bytes[j + 3] << 8);
        if (packet.samples[i][1] >= 0x8000) packet.samples[i][1] -= 0x10000;
        packet.samples[i][2] = bytes[j + 4] | (bytes[j + 5] << 8);
        if (packet.samples[i][2] >= 0x8000) packet.samples[i][2] -= 0x10000;
      }
      //log('STREAMER: RECV-PACKET: ' + JSON.stringify(packet));
      this.packetReceived(packet);

    } else if (type == '!') {
      let numValues = Math.floor(bytes.length / 4);
      if (numValues <= 0) {
        log('STREAMER: RECV-HR (empty)');
      } else {
        log('STREAMER: RECV-HR (' + bytes.length + ' bytes = ' + numValues + ' values)');

        let values = [];
        for (let i = 0; i < numValues; i++) {
          let value = bytes[j + 0] | (bytes[j + 1] << 8) | (bytes[j + 2] << 16) | (bytes[j + 3] << 24);
          let bpm = (value >> 24) & 0xff;
          let als = (value >> 16) & 0xff;
          als = als * (als + 1);  // compander_decompress
          let hrs = value & 0xffff;
          values.push({ bpm, als, hrs });
        }
        log('... ' + JSON.stringify(values));
      }

    } else if (type == '$') {
      log('STREAMER: UNHANDLED: ' + line);

    } else if (type == '#') {
      log('STREAMER: COMMENT: ' + line.substr(1));

    } else {
      log('STREAMER: RECV-LINE [' + line.length + ']: ' + line);
    }
  }

  packetReceived(packet) {
    //log('STREAMER: RECV-PACKET: ' + JSON.stringify(packet));
    this.lastBattery = {
      raw: packet.battRaw,
      voltage: Streamer.rawToBatteryVoltage(packet.battRaw),
      percent: Streamer.rawToBatteryPercentage(packet.battRaw),
    };
    this.lastTemperature = {
      raw: packet.tempRaw,
      celsius: Streamer.rawToTemperatureCelsius(packet.tempRaw),
    }
    const newSamples = [];
    if (this.firstTimestamp === null) {
      this.firstTimestamp = packet.timestamp;  // device timer
      this.firstTime = packet.received;      // milliseconds from epoch
    }
    // 24-bit 1/32768 second timer wraps-around every 512 seconds
    const wrapInterval = (1<<24>>15) * 1000;    // milliseconds
    const approxElapsed = packet.received - this.firstTime; // milliseconds
    const prevWrap = Math.max(Math.floor((approxElapsed - (wrapInterval/2)) / wrapInterval), 0);
    const nextWrap = Math.floor(approxElapsed / wrapInterval);
    const deltaTime = 1000 * ((packet.timestamp - this.firstTimestamp) & 0x00ffffff) / 32768; // milliseconds
    const countWraps = deltaTime >= wrapInterval / 2 ? prevWrap : nextWrap;
    const reconstructedTime = countWraps * wrapInterval + deltaTime;  // milliseconds
    const firstSampleTime = reconstructedTime / 1000;   // seconds
    let sampleSkipped = 0;
    let elapsedTime = 0;
    if (this.lastSampleTime) {
      elapsedTime = firstSampleTime - this.lastSampleTime;
      if (Math.abs(Math.round(elapsedTime)) == 512) {
        log('STREAMER: Warning -- wrap-around not correctly compensated, treating as missed packet: (elapsed: ' + firstSampleTime.toFixed(3) + ' - ' + this.lastSampleTime.toFixed(3) + ' = ' + elapsedTime.toFixed(3) + ')');
        return;
      }
      sampleSkipped = Math.round(elapsedTime * this.streamRate) - 1;
    }
    if (sampleSkipped != 0) {
      log('STREAMER: Warning -- skipped samples: ' + sampleSkipped + ' (elapsed: ' + firstSampleTime.toFixed(3) + ' - ' + this.lastSampleTime.toFixed(3) + ' = ' + elapsedTime.toFixed(3) + ')');
      if (sampleSkipped > 0) {
        this.sampleCount += sampleSkipped;
      }
    }

    for (let i = 0; i < packet.samples.length; i++) {
      const sample = packet.samples[i];
      // TODO: Adjust scale by this.streamRange
      const scale = 1/4096;
      const sampleTime = firstSampleTime + (i / this.streamRate);
      this.lastSampleTime = sampleTime;

      newSamples.push({
        sampleNumber: this.sampleCount + i,
        packetSampleIndex: i,
        // recordingName,
        // deviceId,
        receivedTimestamp: packet.received,   // milliseconds
        rawTimestamp: packet.timestamp,       // 1/32768 seconds
        sampleTime: sampleTime,  // device-based time (seconds)
        estimatedTime: this.firstTime + reconstructedTime + (1000 * (-packet.samples.length + i + 1) / this.streamRate), // milliseconds, real-time estimate relative to first sample received (has long term drift)
        // estimatedTime: packet.received + (1000 * (-packet.samples.length + i + 1) / this.streamRate),  // milliseconds, real-time estimate from received time (can be jittery, no long term drift)
        // batt: packet.battRaw,
        // temp: packet.tempRaw,
        accel: [sample[0] * scale, sample[1] * scale, sample[2] * scale],
      });
    }
    this.packetCount++;
    this.sampleCount += packet.samples.length;

    // Verbose debug info
    if (false) {
      const now = packet.received;
      if (this.debugLastPacketTime) {
        const elapsed = (now - this.debugLastPacketTime) / 1000;
        const packetElapsed = (packet.timestamp - this.lastTimestamp) / 32768;
        const rate = packet.samples.length / elapsed;
        console.log("SAMPLES: After " + elapsed + "s, received " + packet.samples.length + " samples (= " + rate + " Hz; quoted " + this.streamRate + " Hz) -- packet delta time is " + packetElapsed + "s")
      }
      this.debugLastPacketTime = now;
      this.lastTimestamp = packet.timestamp;
    }

    //log('STREAMER: RECV-SAMPLES: ' + JSON.stringify(newSamples));
    this.samples.push(...newSamples);

    if (this.newSamplesHandler) {
      this.newSamplesHandler(newSamples, this);
    }
  }

  setNewSamplesHandler(newSamplesHandler) {
    this.newSamplesHandler = newSamplesHandler;
  }
}
