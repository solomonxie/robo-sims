export interface Planned {
  title: string
  tagline: string
}

export const PLANNED: { title: string; items: Planned[] }[] = [
  {
    title: 'Electricity',
    items: [
      { title: 'Voltage', tagline: 'The push behind the charge' },
      { title: 'Resistance', tagline: 'Why wires and parts resist flow' },
      { title: "Ohm's law", tagline: 'V, I and R in one loop' },
      { title: 'Power', tagline: 'Watts, heat and battery life' },
      { title: 'Series & parallel', tagline: 'How resistors and cells combine' },
      { title: 'Voltage divider', tagline: 'Two resistors, one reading' },
      { title: 'AC vs DC', tagline: 'Steady flow versus sloshing' },
    ],
  },
  {
    title: 'Components',
    items: [
      { title: 'Capacitor', tagline: 'A tiny bucket of charge' },
      { title: 'Inductor', tagline: 'Current that resists change' },
      { title: 'Diode & LED', tagline: 'One-way valves that glow' },
      { title: 'Transistor as a switch', tagline: 'A small current steering a big one' },
      { title: 'Relay', tagline: 'A switch moved by a magnet' },
      { title: 'Battery (18650)', tagline: 'Where the energy comes from' },
      { title: 'Crystal oscillator', tagline: 'The heartbeat of a clock' },
    ],
  },
  {
    title: 'Semiconductors',
    items: [
      { title: 'Silicon & doping', tagline: 'Making a conductor on demand' },
      { title: 'PN junction', tagline: 'Where a diode really lives' },
      { title: 'MOSFET', tagline: 'The switch inside every chip' },
      { title: 'Logic gates', tagline: 'AND, OR, NOT from transistors' },
      { title: 'Memory cell', tagline: 'How a bit is stored' },
    ],
  },
  {
    title: 'Chip making',
    items: [
      { title: 'Lithography machine', tagline: 'Printing circuits with light' },
      { title: 'Wafer to chip', tagline: 'Growing, etching, depositing, cutting' },
      { title: '3 nm chips', tagline: 'What the node name really means' },
    ],
  },
  {
    title: 'Microcontrollers',
    items: [
      { title: 'ESP32 GPIO', tagline: 'Pins as inputs and outputs' },
      { title: 'PWM', tagline: 'Dimming and speed by fast switching' },
      { title: 'ADC', tagline: 'Turning voltage into numbers' },
      { title: 'I²C & SPI', tagline: 'How chips talk to each other' },
      { title: 'UART serial', tagline: 'Bits on a wire, one at a time' },
      { title: 'Wi-Fi & Bluetooth', tagline: 'Radio on a $5 board' },
    ],
  },
  {
    title: 'Sensors',
    items: [
      { title: 'Ultrasonic HC-SR04', tagline: 'Distance from an echo' },
      { title: 'DHT11', tagline: 'Temperature and humidity' },
      { title: 'IR obstacle sensor', tagline: 'Seeing with invisible light' },
      { title: 'Line follower', tagline: 'Reflectance on the floor' },
      { title: 'IMU (MPU6050)', tagline: 'Acceleration and rotation' },
      { title: 'Encoder', tagline: 'Counting wheel turns' },
    ],
  },
  {
    title: 'Motors & motion',
    items: [
      { title: 'DC motor', tagline: 'Magnets, coils and torque' },
      { title: 'H-bridge (L298N)', tagline: 'Forward, reverse, brake' },
      { title: 'Servo', tagline: 'Hold an angle with feedback' },
      { title: 'Stepper', tagline: 'Precise turns, one step at a time' },
      { title: 'Mecanum wheels', tagline: 'Driving sideways' },
      { title: 'Differential drive', tagline: 'Steering with two wheels' },
    ],
  },
  {
    title: 'Robo-car',
    items: [
      { title: 'Chassis & power', tagline: 'Mounting parts, sizing the battery' },
      { title: 'Obstacle avoidance', tagline: 'Sensor to motor, end to end' },
      { title: 'Line following', tagline: 'A feedback loop on wheels' },
      { title: 'Remote control', tagline: 'Drive it from your phone' },
    ],
  },
]
