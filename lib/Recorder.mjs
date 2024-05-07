import Streamer from './Streamer.mjs';
import Device from './Device.mjs';
import Graph from './Graph.mjs';
import Zip from './Zip.mjs';
import { log, download, cleanString } from './Utils.mjs';

const RecordingState = {
  STANDBY: 0,
  STREAMING: 1,
  RECORDING: 2,
};

export default class Recorder {

  constructor(options) {
    this.options = JSON.parse(JSON.stringify(options));
    this.state = RecordingState.STREAMING;
    this.streamers = {};
    this.graphs = {};
    this.title = '';
    this.recordingName = '';
    this.nextStreamerId = 0;
    this.annotationCount = 0;
    this.addingCount = 0;
    this.changeHandler = null;
    this.stats = false;
  }
  
  setTitle(title) {
    this.title = title;
  }

  setChangeHandler(changeHandler) {
    this.changeHandler = changeHandler;
  }

  changed(state) {
    if (this.changeHandler) {
      this.changeHandler(state);
    }
  }

  isAdding() {
    return this.addingCount > 0;
  }

  async addDevice(alternativeDevice) {
    try {
      this.addingCount++;
      this.changed();
      if (this.state >= RecordingState.RECORDING) {
        log('ERROR: Cannot add a new device while recording')
        return;
      }

      log("Choose device");
      let device = null;
      try {
        device = await Device.create(alternativeDevice);
        const newStreamer = new Streamer(device);
        log('Connecting...');
        await newStreamer.initialConnect();

        log('Motor command...');
        await newStreamer.motorCommand();
        //await streamer.ledGreenCommand();
        //await streamer.ledBlueCommand();
//console.log('Bootload...'); await newStreamer.bootloadCommand(); throw new Error("Bootloading");

        log('Handlers...');
        newStreamer.setNewSamplesHandler((newSamples, streamer) => {
          this.newSamples(newSamples, streamer);
        });
        newStreamer.id = this.nextStreamerId++;
        this.streamers[newStreamer.id] = newStreamer;

        const container = document.createElement('DIV');
        container.setAttribute('class', 'graph');
        document.querySelector(this.options.graphsContainer).appendChild(container);
        
        const label = document.createElement('INPUT');
        container.appendChild(label);

        const canvas = document.createElement('CANVAS');
        container.appendChild(canvas);

        const title = newStreamer.deviceId();
label.value = title
        const graph = new Graph(title, canvas);
        graph.showStats(this.stats);
        this.graphs[newStreamer.id] = graph;
        new ResizeObserver(() => graph.redraw()).observe(canvas);

        if (this.state >= RecordingState.STREAMING) {
          log('Starting stream...');
          newStreamer.startStreaming();
        }
        log('...finished adding device.');
    
      } catch(error) {
        log('ERROR: Problem connecting: ' + error);
        if (device) {
          device.destroy();
        }
      }
    } finally {
      this.addingCount--;
      this.changed();
    }
  }

  deviceCount() {
    return Object.keys(this.streamers).length;
  }

  startRecording() {
    this.recordingStart = Date.now();
    const datetime = (new Date(this.recordingStart)).toISOString().replace(/[^0-9]/g,'').substr(0,14); // YYYYMMDDhhmmss
    this.recordingName = datetime;
    if (this.title.length > 0) {
      this.recordingName = this.recordingName + '-' + cleanString(this.title);
    }
    log('RECORD: Start ' + this.recordingName);
    this.recordChunks = {};
    this.annotationCount = 0;
    this.changed();
  }

  addChunk(streamer, chunk) {
    let file;
    if (streamer === null) {
      file = 'annotations.csv';
    } else {
      file = cleanString(streamer.deviceId()) + '.csv';
    }
    if (!this.recordChunks.hasOwnProperty(file)) {
      this.recordChunks[file] = [];
    }
    this.recordChunks[file].push(chunk);
  }

  newSamples(newSamples, streamer) {
    let note = '';
    if (streamer.lastBattery !== null) {
      // streamer.lastTemperature.celsius + '°C'
      // streamer.lastBattery.voltage + 'V '
      note = note + streamer.lastBattery.percent + '%';
    }
    if (streamer.lastBpm !== null) {
      note = note + ' (' + streamer.bpm + '| ' + streamer.lastBpm + ' bpm)';
    }
    this.graphs[streamer.id].setNote(note);
    
    this.graphs[streamer.id].setSamples(streamer.samples);
    if (this.state >= RecordingState.RECORDING) {
      //log('RECV-SAMPLES: ' + JSON.stringify(newSamples));
      let chunk = '';
      for (let sample of newSamples) {
        //// sample.sampleNumber,sample.packetSampleIndex,this.recordingName,this.device.deviceId(),sample.receivedTimestamp,sample.rawTimestamp,sample.sampleTime,sample.estimatedTime,sample.accel[0],,sample.accel[1],,sample.accel[2]
        const hrSampleIndex = sample.hrSampleIndex ? sample.hrSampleIndex : '';
        const hrTime = sample.hrTime ? sample.hrTime : '';
        const bpm = sample.bpm != null ? sample.bpm : '';
        const als = sample.als != null ? sample.als : '';
        const hrs = sample.hrs != null ? sample.hrs : '';
        const line = '' + sample.sampleNumber + ',' + sample.packetSampleIndex + ',' + this.recordingName + ',' + streamer.device.deviceId() + ',' + sample.receivedTimestamp + ',' + sample.rawTimestamp + ',' + sample.sampleTime.toFixed(4) + ',' +  sample.estimatedTime.toFixed() + ',' + sample.accel[0].toFixed(4) + ',' + sample.accel[1].toFixed(4) + ',' + sample.accel[2].toFixed(4) + ',' + hrSampleIndex + ',' + hrTime + ',' + bpm + ',' + als + ',' + hrs + '\r\n';
        chunk += line;
      }
      //console.log(chunk);
      this.addChunk(streamer, chunk);
    }
  }

  endRecording() {
    log('RECORD: Stop');
    const zip = new Zip();
    for (const file in this.recordChunks) {
      zip.addFile(file, this.recordChunks[file]);
    }
    const filename = this.recordingName + '.zip';
    download(filename, zip.getContentAsBlob());
    this.changed();
  }

  isRecording() {
    return this.state == RecordingState.RECORDING;
  }

  isStreaming() {
    return this.state == RecordingState.STREAMING;
  }

  isStandby() {
    return this.state == RecordingState.STANDBY;
  }

  stop() {
    if (this.state >= RecordingState.RECORDING) {
      this.endRecording();
    }
    if (this.state > RecordingState.STANDBY) {
      log('Stopping stream...');
      for (let streamer of Object.values(this.streamers)) {
        streamer.stopStreaming();
      }
      this.state = RecordingState.STANDBY;
    }
    this.changed();
  }

  stream() {
    if (this.state >= RecordingState.RECORDING) {
      this.state = RecordingState.STREAMING;
      this.endRecording();
    }
    if (this.state < RecordingState.STREAMING) {
      log('Starting stream...');
      for (let streamer of Object.values(this.streamers)) {
        streamer.startStreaming();
      }
    }
    this.state = RecordingState.STREAMING;
    this.changed();
  }

  record() {
    if (this.state < RecordingState.RECORDING) {
      log('Starting record...');
      this.stream();
      this.startRecording();
      this.state = RecordingState.RECORDING;
    }
    this.changed();
  }

  annotate(tag) {
    if (this.state >= RecordingState.RECORDING) {
      const now = Date.now();
      const sampleNumber = this.annotationCount;
      const packetSampleIndex = 0;
      const deviceId = '$ANNOTATION';
      const receivedTimestamp = now;
      const rawTimestamp = ((now - this.recordingStart) * 32768 / 1000) | 0;
      const sampleTime = (now - this.recordingStart) / 1000;
      const sampleEstimatedTime = now;
      const accel = [0, 0, 0];
      const label = tag;
      const line = '' + sampleNumber + ',' + packetSampleIndex + ',' + this.recordingName + ',' + deviceId + ',' + receivedTimestamp + ',' + rawTimestamp + ',' + sampleTime.toFixed(4) + ',' +  sampleEstimatedTime.toFixed() + ',' + accel[0].toFixed(4) + ',' + accel[1].toFixed(4) + ',' + accel[2].toFixed(4) + ',' + label + '\r\n';
      this.addChunk(null, line);

      log('ANNOTATION #' + this.annotationCount + ' @' + (new Date(now)).toISOString() + ': ' + tag);
      console.log(line);

      this.annotationCount++;
    }
  }

  toggleStats() {
    this.stats = !this.stats;
    for (let graph of Object.values(this.graphs)) {
      graph.showStats(this.stats);
    }
  }

}
