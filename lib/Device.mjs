import { log } from './Utils.mjs';

export default class Device {
  constructor(bluetoothDevice) {
    this.bluetoothDevice = bluetoothDevice;
    this.receiveBuffer = [];
    this.lineHandler = null;
    if (Device.devices[this.bluetoothDevice.id]) {
      throw ('ERROR: Device object already created for this device.');
    }
    Device.devices[this.bluetoothDevice.id] = this;
    this.connecting = null;
  }

  destroy() {
    log('DEVICE: Destroy.');
    this.disconnect();
    delete Device.devices[this.bluetoothDevice.id];
  }

  deviceId() {
    // If we have an externally set identifier, use this
    if (this.id) {
      return this.id;
    }
    // If we have it (but we won't as it is blacklisted) Use the serial number from device information
    if (this.deviceInformation && this.deviceInformation.serialNumber) {
      return this.deviceInformation.serialNumber;
    }
    // Use the device's name and the temporary (session) unique device id
    return this.bluetoothDevice.name + '#' + this.bluetoothDevice.id;
  }

  async getDeviceInformation() {
    let deviceInformation = {};
    log('DEVICEINFO: Getting service...');
    const serviceDeviceInformation = await this.server.getPrimaryService('device_information');
    log('DEVICEINFO: Getting characteristics...');
    const characteristics = await serviceDeviceInformation.getCharacteristics();
    const decoder = new TextDecoder('utf-8');
    for (const characteristic of characteristics) {
      switch (characteristic.uuid) {
        case BluetoothUUID.getCharacteristic('serial_number_string'): // 0x2A25 -- Blacklisted in WebBluetooth?!?!
          deviceInformation.serialNumber = decoder.decode(await characteristic.readValue());
          break;
        case BluetoothUUID.getCharacteristic('firmware_revision_string'): // 0x2A26
          deviceInformation.firmwareRevision = decoder.decode(await characteristic.readValue());
          break;
        case BluetoothUUID.getCharacteristic('hardware_revision_string'): // 0x2A27
          deviceInformation.hardwareRevision = decoder.decode(await characteristic.readValue());
          break;
        // case BluetoothUUID.getCharacteristic('software_revision_string'): // 0x2A28
        //   deviceInformation.softwareRevision = decoder.decode(await characteristic.readValue());
        //   break;
        case BluetoothUUID.getCharacteristic('manufacturer_name_string'): // 0x2A29
          deviceInformation.manufacturerName = decoder.decode(await characteristic.readValue());
          break;
        default:
          log('DEVICEINFO: NOTE: Unknown Characteristic: ' + characteristic.uuid);
          break;
      }
    }
    return deviceInformation;
  }

  async findUart() {
    let uart = {};
    log('UART: Getting service...');
    const serviceUart = await this.server.getPrimaryService(Device.uuidServiceUart);
    log('UART: Getting characteristics... ' + Device.uuidCharacteristicRx + ', ' + Device.uuidCharacteristicTx);
    const characteristics = await serviceUart.getCharacteristics();
    for (const characteristic of characteristics) {
      // if (characteristic == BluetoothUUID.getCharacteristic(Device.uuidCharacteristicRx)) {
      if (characteristic.uuid == Device.uuidCharacteristicRx) {
        uart.characteristicRx = characteristic;
        // } else if (characteristic == BluetoothUUID.getCharacteristic(Device.uuidCharacteristicTx)) {
      } else if (characteristic.uuid == Device.uuidCharacteristicTx) {
        uart.characteristicTx = characteristic;
      } else {
        log('UART: WARNING: Unknown characteristic: ' + characteristic.uuid);
      }
    }
    if (!uart.characteristicRx || !uart.characteristicTx) {
      throw new Error('UART: One or more required characteristics not found.');
    }
    return uart;
  }

  async connectUart() {
    // Find UART characteristics (must be repeated if reconnected)
    this.uart = await this.findUart();

    // Receive handler
    this.receiveHandler = (event) => { this.receive(event); }
    this.uart.characteristicRx.addEventListener('characteristicvaluechanged', this.receiveHandler);

    this.gattServerDisconnected = () => {
      log('GATT-DISCONNECT: Remove receive listener');
      //this.uart.characteristicRx.stopNotifications(); // async -- can't do this if disconnected anyway!
      if (this.receiveHandler) {
        this.uart.characteristicRx.removeEventListener('characteristicvaluechanged', this.receiveHandler);
        this.receiveHandler = null;
      }
      this.receiveBuffer.splice(0);
      this.bluetoothDevice.removeEventListener('gattserverdisconnected', this.gattServerDisconnected);
      this.gattServerDisconnected = null;
      if (this.disconnectedHandler) {
        this.disconnectedHandler(this);
      }
    }
    this.bluetoothDevice.addEventListener('gattserverdisconnected', this.gattServerDisconnected);

    await this.uart.characteristicRx.startNotifications();
  }

  receive(event) {
    const value = event.target.value;
    //log('UART: RECV: ' + hexDump(value));
    for (let i = 0; i < value.byteLength; i++) {
      this.receiveBuffer.push(value.getUint8(i))
    }
    let idx;
    while ((idx = this.receiveBuffer.indexOf(10)) >= 0) {
      const line = this.receiveBuffer.splice(0, idx + 1);
      line.pop(); // remove LF
      if (line.length > 0 && line[line.length - 1] == 13) line.pop(); // remove CR
      const decoder = new TextDecoder('utf-8');
      const lineString = decoder.decode(new Uint8Array(line))
      this.receiveLine(lineString);
    }
  }

  receiveLine(line) {
    //log('UART: RECV-LINE: ' + line);
    if (this.lineHandler) {
      this.lineHandler(line);
    }
  }

  setLineHandler(lineHandler) {
    const oldLineHandler = this.lineHandler;
    this.lineHandler = lineHandler;
    return oldLineHandler;
  }

  setDisconnectedHandler(disconnectedHandler) {
    this.disconnectedHandler = disconnectedHandler;
  }

  async write(data) {
    if (!this.uart || !this.uart.characteristicTx) {
      throw ('ERROR: Cannot write, no UART.');
    }
    const max = 20;
    for (let offset = 0; offset < data.length; offset += max) {
      const chunk = data.slice(offset, offset + max);
      log('UART: WRITE [' + offset + '/' + data.length + ']'); // hexDump(chunk)
      await this.uart.characteristicTx.writeValue(chunk);
    }
  }

  async writeLine(line) {
    const encoder = new TextEncoder('utf-8');
    log('UART: WRITE-LINE: ' + line);
    const message = line + '\n';
    const data = encoder.encode(message);
    await this.write(data);
  }

  isConnected() {
    return this.bluetoothDevice.gatt.connected;
  }

  isConnecting() {
    return this.connecting !== null; // && (Date.now - this.connecting) < 5000;
  }

  async connect() {
    log('CONNECT: Connecting to GATT server...');
    if (this.bluetoothDevice.gatt.connected) {
      log('CONNECT: Device is already connected');
      return;
    }
    try {
      this.connecting = Date.now;
      this.server = await this.bluetoothDevice.gatt.connect();
      await this.connectUart();
      log('UART: ' + JSON.stringify(this.uart));
      if (!this.deviceInformation) {
        //this.deviceInformation = await this.getDeviceInformation();
      }
    } catch (error) {
      await this.disconnect();
      throw (error);
    } finally {
      this.connecting = null;
    }
  }

  async disconnect() {
    log('DISCONNECT: Disconnecting from GATT server...');
    if (!this.bluetoothDevice.gatt.connected) {
      log('DISCONNECT: Device is already disconnected');
      return;
    }
    await this.bluetoothDevice.gatt.disconnect();
  }

  static async create() {
    if (location.protocol === 'http:') {
      log('WARNING: WebBluetooth typically not supported for HTTP protocol -- you may need to use file:, https:, or content:');
    }
    if (!navigator.bluetooth) {
      log('ERROR: No navigator.bluetooth support');
      throw ('navigator.bluetooth not supported')
    }
    if (navigator.bluetooth.getAvailability && !await navigator.bluetooth.getAvailability()) {
      log('WARNING: It appears as if Bluetooth is not available -- the device request will fail.');
    }
    log('CONNECT: Requesting devices... (this location protocol: ' + location.protocol + ')');

    let bluetoothDevice = await navigator.bluetooth.requestDevice({
      filters: [
        //{ namePrefix: 'axLE-Band' },
        //{ namePrefix: 'I5-Om' },
//        { services: [this.uuidServiceUart] },
{ namePrefix: 'InfiniTime' },
      ],
      optionalServices: ['device_information', this.uuidServiceUart],
      //acceptAllDevices: true,
    });

    return new Device(bluetoothDevice);
  }

}
Device.devices = {};
Device.uuidServiceUart = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
Device.uuidCharacteristicTx = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
Device.uuidCharacteristicRx = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';
