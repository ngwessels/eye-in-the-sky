export type PanTiltPose = { pan: number; tilt: number };

export interface PanTiltDriver {
  getPose(): PanTiltPose;
  safeHome(): Promise<void>;
  applyAbsolute(azimuthDeg: number, elevationDeg: number): Promise<void>;
  applyDelta(deltaPanDeg: number, deltaTiltDeg: number): Promise<void>;
}
