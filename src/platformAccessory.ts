import { Service, PlatformAccessory, CharacteristicValue, CharacteristicSetCallback, CharacteristicGetCallback } from 'homebridge';
import * as request from 'superagent';

import { EasyrollHomebridgePlatform } from './platform';

function posFlip(pos: number): number {
  return 100 - pos;
}

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class EasyrollAccessory {
  private service: Service;

  /**
   * These are just used to create a working example
   * You should implement your own code to track the state of your accessory
   */
  private exampleStates = {
    On: true,
    Position: 100,
    TargetPosition: -1,
  };

  private intervalPosition: NodeJS.Timeout | null = null;

  constructor(
    private readonly platform: EasyrollHomebridgePlatform,
    private readonly accessory: PlatformAccessory,
  ) {

    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Default-Manufacturer')
      .setCharacteristic(this.platform.Characteristic.Model, 'Default-Model')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, 'Default-Serial');

    // get the LightBulb service if it exists, otherwise create a new LightBulb service
    // you can create multiple services for each accessory
    this.service = this.accessory.getService(this.platform.Service.WindowCovering)
      || this.accessory.addService(this.platform.Service.WindowCovering);

    // set the service name, this is what is displayed as the default name on the Home app
    // in this example we are using the name we stored in the `accessory.context` in the `discoverDevices` method.
    this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.exampleDisplayName);

    this.service.getCharacteristic(this.platform.Characteristic.On)
      .on('set', this.setOn.bind(this))                // SET - bind to the `setOn` method below
      .on('get', this.getOn.bind(this));               // GET - bind to the `getOn` method below

    this.service.getCharacteristic(this.platform.Characteristic.CurrentPosition)
      .on('get', this.getPosition.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.TargetPosition)
      .on('get', this.getTargetPosition.bind(this))
      .on('set', this.setTargetPosition.bind(this));
  }

  /**
   * Handle "SET" requests from HomeKit
   * These are sent when the user changes the state of an accessory, for example, turning on a Light bulb.
   */
  setOn(value: CharacteristicValue, callback: CharacteristicSetCallback) {

    // implement your own code to turn your device on/off
    this.exampleStates.On = value as boolean;

    this.platform.log.debug('Set Characteristic On ->', value);

    // you must call the callback function
    callback(null);
  }

  getOn(callback: CharacteristicGetCallback) {
    const isOn = this.exampleStates.On;

    this.platform.log.debug('Get Characteristic On ->', isOn);
    callback(null, isOn);
  }


  async getPosition(callback: CharacteristicSetCallback) {
    const currentPosition = await this.getEasyrollInfo();
    this.platform.log.debug('Get Characteristic Position', currentPosition);
    callback(null, currentPosition);
  }

  async getTargetPosition(callback: CharacteristicSetCallback) {
    if (this.exampleStates.TargetPosition < 0) {
      const currentPosition = await this.getEasyrollInfo();
      this.exampleStates.TargetPosition = currentPosition;
    }
    this.platform.log.debug('Get Characteristic Target Position', this.exampleStates.TargetPosition);
    callback(null, this.exampleStates.TargetPosition);
  }

  private async getEasyrollInfo(): Promise<number> {
    const res = await request.get('http://192.168.0.70:20318/lstinfo');
    const info = JSON.parse(res.text);
    info.position = posFlip(Math.floor(info.position));
    this.exampleStates.Position = info.position;
    if (this.exampleStates.TargetPosition < 0) {
      this.exampleStates.TargetPosition = this.exampleStates.Position;
    }
    return info.position;
  }

  private async setEasyrollPosition(target: number) {
    return request.post('http://192.168.0.70:20318/action')
      .send({
        mode: 'level',
        command: posFlip(target),
      });
  }

  async setTargetPosition(value: CharacteristicValue, callback: CharacteristicSetCallback) {
    this.platform.log.debug('Set Characteristic Target Position -> ', value);
    this.exampleStates.TargetPosition = value as number;
    callback(null);

    await this.setEasyrollPosition(this.exampleStates.TargetPosition);
    
    if (this.intervalPosition) {
      clearInterval(this.intervalPosition);
    }
    this.intervalPosition = setInterval(async () => {
      const currentPosition = await this.getEasyrollInfo();
      this.platform.log.debug(`Moving ${value} => ${currentPosition}}`);
      const diff = Math.abs(currentPosition - this.exampleStates.TargetPosition);
      if (diff < 4) {
        this.exampleStates.Position = this.exampleStates.TargetPosition;
        this.service.updateCharacteristic(this.platform.Characteristic.CurrentPosition, this.exampleStates.TargetPosition);

        if (this.intervalPosition) {
          clearInterval(this.intervalPosition);
        }
      }
    }, 1000);
  }
}
