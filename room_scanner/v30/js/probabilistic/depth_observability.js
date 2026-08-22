export function assessDepthCalibrationObservability(points){return {observable:(points?.length||0)>=4,score:1,anchorCount:points?.length||0};}
