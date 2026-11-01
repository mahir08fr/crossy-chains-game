// Test driver only: reject a straight force-driven crossing if any swept vehicle
// can reach any player's lateral footprint in the predicted lane-time window.
import { roadLanes, roadSettings, settings } from '@crossy/config';
import { vehicleX } from '@crossy/simulation';
// The driver commands .65 land input. Predict below that target to allow
// original friction/cable load; derive from the authoritative speed so later
// refinements cannot retain an obsolete 4.8-m/s crossing assumption.
export const driverCrossingSpeed = settings.player.speed * .6;
export function roadCrossingClear(section,time,players) {
 const lanes=roadLanes(section),minZ=Math.min(...players.map(p=>p.position.z));
 for(const [laneIndex,l] of lanes.entries()){
  const start=time+Math.max(0,(l.z-minZ-1.3)/driverCrossingSpeed),end=time+Math.max(0,(l.z-minZ+1.8)/driverCrossingSpeed)+.6;
  for(let slot=0;slot<l.positions.length;slot++){
   const x=vehicleX(laneIndex,slot,start,lanes,3),delta=l.speed*l.direction*(end-start);
   const half=roadSettings.carHalfSize.x*l.scale+.6;
   for(const p of players){
    if(Math.ceil((p.position.x-half-Math.max(x,x+delta))/l.period)<=Math.floor((p.position.x+half-Math.min(x,x+delta))/l.period))return false;
   }
  }
 }
 return true;
}
