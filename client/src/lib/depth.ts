const DEPTH = ['#e66767', '#eda100', '#1baf7a', '#3987e5', '#9085e9']
/** Hop colour, shared by the network screen, overview and anomalies (wraps past 5 hops). */
export const depthColor = (d: number) => DEPTH[d % DEPTH.length]
