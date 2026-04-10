export type SensorReading = {
  sensorId: string;
  type: string;
  value: number;
  unit: string;
  observedAt: string;
};

export interface SensorDriver {
  readonly id: string;
  read(): Promise<SensorReading[]>;
}
