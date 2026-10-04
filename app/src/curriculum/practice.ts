import { category } from './build'

export const practice = [
  category('projects', 'Robot projects', '★', 'Build real robots, step by step', [
    ['Robo-car', 'A two-wheel drive base', [['Chassis & power', 'build', 8], ['Wire the motor driver', 'build', 8], ['Drive with ESP32', 'build', 10], ['Phone remote', 'build', 10]]],
    ['Obstacle-avoiding car', 'Ultrasonic + steering', [['Mount the sensor', 'build', 6], ['Reactive logic', 'build', 8], ['Tune and test', 'build', 6]]],
    ['Line-following car', 'IR array + PD', [['Sensor array', 'build', 8], ['PD controller', 'build', 10], ['Intersections', 'build', 8]]],
    ['Self-balancing robot', 'IMU + PID', [['Build the base', 'build', 10], ['Read the tilt', 'build', 8], ['Tune the loop', 'build', 12]]],
    ['Robot arm', '4-DOF servo arm', [['Assemble', 'build', 10], ['Calibrate servos', 'build', 6], ['IK control', 'build', 10]]],
    ['Quadruped', '8-servo walker', [['Leg geometry', 'build', 10], ['Gait generator', 'build', 12]]],
    ['Maze solver', 'Micromouse-style', [['Wall sensing', 'build', 8], ['Flood fill', 'build', 10]]],
    ['Sumo robot', 'Push the other off the ring', [['Wedge and wheels', 'build', 8], ['Edge and opponent sensing', 'build', 10]]],
    ['Camera tracker', 'Pan-tilt that follows a ball', [['Pan-tilt rig', 'build', 8], ['Colour tracking loop', 'build', 10]]],
    ['Weather station', 'Sensors to a dashboard', [['Wire the sensors', 'build', 6], ['Send over Wi-Fi', 'build', 8]]],
    ['Smart plant monitor', 'Moisture, pump and alerts', [['Moisture probe', 'build', 6], ['Pump control', 'build', 8]]],
    ['Desk lamp tracker', 'Light-seeking servo', [['LDR pair', 'build', 6], ['Servo follow', 'build', 8]]],
  ], 'practice'),
  category('challenges', 'Circuit challenges', '◆', 'Solve it before you wire it', [
    ['LED puzzles', 'Pick the resistor', ['Safe LED current', 'Two LEDs, one supply', 'Brightness target']],
    ['Divider puzzles', 'Hit a target voltage', ['3.3 V from 5 V', 'ADC range matching']],
    ['Motor driver puzzles', 'Direction and speed', ['Truth table challenge', 'PWM speed target']],
    ['Battery puzzles', 'Sizing a pack', ['Runtime target', 'Series count']],
    ['Logic puzzles', 'Gates to a goal', ['Build XOR', 'Design a 2-bit counter']],
    ['Timing puzzles', 'RC and 555 timing', ['Blink at 1 Hz', 'Debounce time']],
  ], 'practice'),
  category('debugging', 'Debug it', '✱', 'Find the fault in a broken build', [
    ['Won’t power on', 'Start with the supply', ['Dead battery', 'Reverse polarity', 'Short circuit']],
    ['Motor does nothing', 'Driver, wiring or code?', ['Missing enable pin', 'Common ground missing', 'Stalled gearbox']],
    ['Random resets', 'Brownout hunting', ['Motor spike resets', 'Weak regulator']],
    ['Sensor noise', 'Jittery readings', ['Floating input', 'Missing decoupling']],
    ['Bus not responding', 'I²C and SPI faults', ['Wrong address', 'Missing pull-ups']],
    ['Robot drifts', 'Straight lines that aren’t', ['Motor mismatch', 'Wheel size error']],
    ['Using a multimeter', 'Measure, don’t guess', ['Continuity test', 'Voltage test', 'Current test']],
  ], 'practice'),
  category('workshop', 'Workshop skills', '✂', 'Hands-on techniques', [
    ['Soldering', 'Joints that last', ['Iron and flux', 'Good vs cold joints', 'Desoldering']],
    ['Breadboarding', 'Prototype without solder', ['Rails and rows', 'Tidy wiring', 'Common mistakes']],
    ['Crimping & connectors', 'JST, Dupont, XT60', ['Crimping a pin', 'Choosing connectors']],
    ['Measuring', 'Calipers, scales, multimeters', ['Reading a caliper', 'Tolerances']],
    ['Safety', 'Batteries, soldering, tools', ['LiPo safety', 'Fume and eye protection']],
    ['Tool kit', 'What to buy first', ['Starter bench', 'Parts shopping list']],
  ], 'practice'),
]
