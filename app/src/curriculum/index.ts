import { chargingAndDischarging, decoupling, electrolyticVsCeramic, rcTimeConstant } from '../lessons/components/capacitor'
import { flybackDiode, forwardDrop, reverseBlocking, zenerClamp } from '../lessons/components/diode'
import { energyInACoil, flybackSpike, rlTimeConstant } from '../lessons/components/inductor'
import { currentLimitingResistor, forwardVoltageAndColour, ledMatrix, rgbLed } from '../lessons/components/led'
import { baseResistor, gainAndSaturation, npnAsASwitch } from '../lessons/components/transistor-bjt'
import { gateDrive, gateThreshold, logicLevelMosfets, lowSideSwitching } from '../lessons/components/mosfet'
import { coilAndContacts, drivingARelay, solidStateRelay } from '../lessons/components/relay'
import { contactBounce, debouncing, toggleVsMomentary } from '../lessons/components/switches-buttons'
import { linearVsLogTaper, wiperAsDivider } from '../lessons/components/potentiometer'
import { fuseRatings, reversePolarity, tvsDiode } from '../lessons/components/fuses-protection'
import { clockAccuracy, loadCapacitors, resonance } from '../lessons/components/crystal-oscillator'
import { comparator, idealRules, invertingAmplifier, voltageFollower } from '../lessons/components/op-amp'
import { boostConverter, buckConverter, dropoutAndHeat, linearLdo } from '../lessons/components/voltage-regulators'
import { powerRating, pullUpAndPullDown, valueAndTolerance } from '../lessons/components/resistor'
import { frequencyAndPeriod, mainsVsBattery, sineAndRms } from '../lessons/electricity/ac-dc'
import { ampsAndCoulomb, conventionalVsElectron, whatFlows } from '../lessons/electricity/current'
import { capacitanceFromPlates, coulombLaw, fieldLineMap } from '../lessons/electricity/electric-fields'
import { induction, rightHandRule, solenoid, wireAndCompass } from '../lessons/electricity/magnetism'
import { ohmPlot, solvingALoop, vEqualsIR } from '../lessons/electricity/ohms-law'
import { kclAtANode, kvlAroundALoop, nodalAnalysis } from '../lessons/electricity/kirchhoffs-laws'
import { heatInAResistor, pEqualsVI, whAndMah } from '../lessons/electricity/power-energy'
import { cellsSeriesParallel, mixedNetworks, parallelResistors, seriesResistors } from '../lessons/electricity/series-parallel'
import { readingResistorBands, resistivityAndGauge, temperatureEffects } from '../lessons/electricity/resistance'
import { dividerFormula, dividerSensor, loadingDivider } from '../lessons/electricity/voltage-divider'
import { maximumPowerTransfer, theveninEquivalent } from '../lessons/electricity/thevenin-norton'
import { groundAndReference, measuringWithMultimeter, potentialDifference } from '../lessons/electricity/voltage'
import { lithographyMachine, waferToChip, what3nmMeans } from '../lessons/semiconductors/chip-making'
import { channelFormation, cmosInverterLesson, switchingEnergyLesson } from '../lessons/semiconductors/mosfet-physics'
import { adders, nandFromTransistors, truthTables } from '../lessons/semiconductors/logic-gates'
import { dramCapacitor, flashFloatingGate, sramLatch } from '../lessons/semiconductors/memory-cell'
import { breakdown, depletionRegion, forwardAndReverseBias } from '../lessons/semiconductors/pn-junction'
import { bandGap, holesAndElectrons, nAndPType } from '../lessons/semiconductors/silicon-doping'
import { binaryCounting, hexShorthand, twosComplement } from '../lessons/digital/binary-hex'
import { decoder, halfAndFullAdder, multiplexer, tableToCircuit } from '../lessons/digital/combinational-logic'
import { dFlipFlop, registers, srLatch } from '../lessons/digital/flip-flops-latches'
import { hc595, rippleCounter, shiftRegister } from '../lessons/digital/counters-shift-registers'
import { mooreVsMealy, robotBehaviour, trafficLight } from '../lessons/digital/state-machines'
import { clockDividers, metastability, propagationDelay } from '../lessons/digital/timing'
import { bidirectionalShifter, dividerShifter, logicThresholds } from '../lessons/digital/level-shifting'
import { blinkyInHardware, luts } from '../lessons/digital/fpga-basics'
import { capacityAndCRate, cellVoltageCurve, internalResistance } from '../lessons/power/battery-chemistry'
import { balancing, bmsProtection, oneSToFourS } from '../lessons/power/18650-packs'
import { chargeCurveLesson, thermalLimits, tp4056 } from '../lessons/power/charging'
import { choosingAModule, efficiency, inductorRipple } from '../lessons/power/buck-boost'
import { addUpTheLoads, peakVsAverage, runtimeEstimate } from '../lessons/power/power-budget'
import { connectorRatings, starGround, voltageDrop } from '../lessons/power/wiring-gauge'
import { bulkCapacitors, motorNoise, separateRails } from '../lessons/power/noise-decoupling'
import { currentSpikes, diagnosingResets } from '../lessons/power/brownouts'
import { bodePlot, highPass, rcLowPass } from '../lessons/signals/filters'
import { aliasing, nyquistLimit, spectrum } from '../lessons/signals/fourier-intuition'
import { decodingBus, probing, triggering } from '../lessons/signals/oscilloscope'
import { captureI2c, captureSpi, patternTrigger, sampleRate } from '../lessons/signals/logic-analyzer'
import { reflections, termination } from '../lessons/signals/transmission-lines'
import { antennaTypes, lora, twoFourGhz } from '../lessons/signals/radio-basics'
import { cableShields, groundLoops, twistedPairs } from '../lessons/signals/grounding-shielding'
import { layoutRules, manufacturing, schematicCapture, tracesAndVias } from '../lessons/signals/pcb-design'
import { Lesson } from '../lessons/types'
import { electronics } from './electronics'
import { driveStrength, interrupts, outputAndInputModes, pullUps } from '../lessons/microcontrollers/gpio'
import { averageVoltage, dutyCycle, frequencyChoice, servoPulses } from '../lessons/microcontrollers/pwm'
import { esp32AdcQuirks, noiseAndAveraging, resolutionAndRange, sampling } from '../lessons/microcontrollers/adc'
import { audioOut, r2rLadder } from '../lessons/microcontrollers/dac'
import { hardwareTimers, isrRules, millisWithoutDelay } from '../lessons/microcontrollers/timers-interrupts'
import { framingAndBaud, gpsAndModules, levelAndNoise } from '../lessons/microcontrollers/uart-serial'
import { addresses, busScan, pullUpResistors, readingAnImu } from '../lessons/microcontrollers/i2c'
import { chipSelect, clockModes, sdCardsAndDisplays } from '../lessons/microcontrollers/spi'
import { arbitration, differentialSignalling } from '../lessons/microcontrollers/can-bus'
import { bleGatt, espNow, httpAndWebSocket, stationAndAp } from '../lessons/microcontrollers/wifi-bluetooth'
import { batteryBudget, deepSleep, wakeSources } from '../lessons/microcontrollers/power-modes'
import { flashLayout, littleFs, stackAndHeap } from '../lessons/microcontrollers/memory-storage'
import { mutexes, queues, tasksAndPriorities } from '../lessons/microcontrollers/rtos-basics'
import { bootModes, otaUpdates } from '../lessons/microcontrollers/bootloader-flashing'
import { beamAngle, softTargetErrors, timeOfFlight } from '../lessons/sensors/ultrasonic'
import { lineFollower, obstacleSensor, sunlightInterference } from '../lessons/sensors/infrared'
import { multiZoneRanging, vl53l0x } from '../lessons/sensors/time-of-flight-laser'
import { pointClouds, rangeAndResolution, scan2d } from '../lessons/sensors/lidar'
import { countsPerRevolution, quadrature, speedFromTicks } from '../lessons/sensors/encoder'
import { accelerometer, complementaryFilter, drift, gyroscope } from '../lessons/sensors/imu'
import { hardIronCalibration, heading } from '../lessons/sensors/magnetometer'
import { fixAndAccuracy, rtk, trilateration } from '../lessons/sensors/gps'
import { exposure, lensDistortion, rollingVsGlobalShutter } from '../lessons/sensors/camera'
import { oneWireProtocol, thermistorCurve } from '../lessons/sensors/temperature-humidity'
import { ina219, shuntResistor, stateOfCharge } from '../lessons/sensors/current-voltage-sensing'
import { capacitiveTouch, strainGauge } from '../lessons/sensors/force-touch'
import { memsMic, soundSourceDirection } from '../lessons/sensors/microphone-sound'
import { complementaryHeading, kalmanIntuition, whyFuse } from '../lessons/sensors/sensor-fusion'
import { fixedRateControlLoop, hardwareAbstraction, superLoopVsRtos } from '../lessons/software/firmware-structure'
import { launchFiles, publishAndSubscribe, servicesAndActions } from '../lessons/software/ros2-concepts'
import { frameTree, writingAUrdf } from '../lessons/software/tf-urdf'
import { behaviourTrees, costmaps } from '../lessons/software/nav2'
import { agentAndClient, serialTransport } from '../lessons/software/micro-ros'
import { physicsEngine, simToRealGap } from '../lessons/software/simulation'
import { blackboard, sequenceAndFallback } from '../lessons/software/behaviour-trees'
import { plottingLiveData, replayLogs } from '../lessons/software/telemetry-logging'
import { joystickOverBle, latency, webSocketControl } from '../lessons/software/remote-control'
import { eStop, faultStates, watchdog } from '../lessons/software/safety-failsafes'
import { backEmfLesson, gearboxes, stallCurrent, torqueAndSpeedCurve } from '../lessons/actuators/dc-motor'
import { decayModes, fourSwitches, l298nVsModernDrivers, shootThroughLesson } from '../lessons/actuators/h-bridge'
import { insideAHobbyServo, jitterAndPower, pulseToAngle } from '../lessons/actuators/servo'
import { a4988AndTmcDrivers, fullHalfAndMicroSteps, missedSteps } from '../lessons/actuators/stepper'
import { escBasics, hallSensors, threePhaseDrive } from '../lessons/actuators/brushless-bldc'
import { clarkeAndPark, currentLoops } from '../lessons/actuators/field-oriented-control'
import { leadScrewLesson, limitSwitches } from '../lessons/actuators/linear-actuators'
import { peristalticPump, solenoidDrive } from '../lessons/actuators/solenoids-pumps'
import { backlash, gearRatioLesson, planetaryGears, wormDrive } from '../lessons/actuators/gear-trains'
import { pneumaticCylinder, softGripper } from '../lessons/actuators/pneumatics-soft-robots'
import { dutyCycleLesson, thermalLimitsLesson, torqueBudgetLesson } from '../lessons/actuators/motor-selection'
import { odometryLesson, slipLesson, turnRadiusLesson } from '../lessons/mobility/differential-drive'
import { rollerGeometry, strafeMaths, whyTheySlip } from '../lessons/mobility/mecanum-wheels'
import { omniWheelsLesson, swerveModule } from '../lessons/mobility/omni-swerve'
import { bicycleModel, steeringGeometry } from '../lessons/mobility/ackermann-steering'
import { skidSteer, tractionLesson } from '../lessons/mobility/tracks-terrain'
import { gaitCycle, legIk, zeroMomentPoint } from '../lessons/mobility/legged-walking'
import { selfBalancingCar, tiltPid, whyItFalls } from '../lessons/mobility/balancing-robots'
import { attitudeControl, quadcopterMixing } from '../lessons/mobility/drones-flight'
import { buoyancyLesson, thrusterLayout } from '../lessons/mobility/underwater-swimming'
import { chatter, thermostat } from '../lessons/control/bang-bang-hysteresis'
import { derivativeKick, integralWindup, proportionalOnly, tuningByHand, zieglerNicholsLesson } from '../lessons/control/pid'
import { encoderFeedback, feedForward, velocityPid } from '../lessons/control/speed-control'
import { sCurve, trapezoidProfile } from '../lessons/control/position-control'
import { errorFromSensors, intersections, pdSteering } from '../lessons/control/line-following'
import { gainAndPhaseMargin, polesAndDamping, stepResponse } from '../lessons/control/stability'
import { lqrIntuition, stateVector } from '../lessons/control/state-space-lqr'
import { mpcConstraints, recedingHorizon } from '../lessons/control/model-predictive-control'
import { kalmanFilter, lowPass, movingAverage } from '../lessons/control/filters-in-the-loop'
import { coordFrameTree, homogeneousTransforms, rotation2d } from '../lessons/kinematics/coordinate-frames'
import { denavitHartenberg, twoLinkArm } from '../lessons/kinematics/forward-kinematics'
import { analyticIk, jacobianMethod, multipleSolutions } from '../lessons/kinematics/inverse-kinematics'
import { jacobianManipulability, jacobianSingularities } from '../lessons/kinematics/jacobian'
import { workspaceDexterity, workspaceReach } from '../lessons/kinematics/workspace'
import { trajectoriesLinear, trajectoriesSplines, trajectoriesTimeScaling } from '../lessons/kinematics/trajectories'
import { grippersCompliance, grippersParallelJaw, grippersSuction } from '../lessons/kinematics/grippers'
import { armBuildAssemble, armBuildDriveIk } from '../lessons/kinematics/robot-arm-build'
import { dynamicsGravityTorque, dynamicsInertia, dynamicsPayloadLimits } from '../lessons/kinematics/dynamics'
import { imageBasicsHistogram, imageBasicsRgbHsv, imageBasicsThresholding } from '../lessons/perception/image-basics'
import { edgesFeaturesCannyEdges, edgesFeaturesConvolution, edgesFeaturesCorners } from '../lessons/perception/edges-features'
import { colourTrackingCentroidSteering, colourTrackingHsvMask } from '../lessons/perception/colour-tracking'
import { cameraModelCalibration, cameraModelPinholeModel, cameraModelStereoDepth } from '../lessons/perception/camera-model'
import { fiducialMarkersDetectingATag, fiducialMarkersPoseFromATag } from '../lessons/perception/fiducial-markers'
import { objectDetectionEdgeAccelerators, objectDetectionRunningOnAnEsp32Cam, objectDetectionYoloIdea } from '../lessons/perception/object-detection'
import { depthSensingDepthMap, depthSensingPointCloud } from '../lessons/perception/depth-sensing'
import { opticalFlowLucasKanade, opticalFlowVisualOdometry } from '../lessons/perception/optical-flow'
import { occupancyGridsLogOddsUpdate, occupancyGridsRayCasting } from '../lessons/perception/occupancy-grids'
import { odometryCalibratingWheelSize, odometryDeadReckoning, odometryErrorGrowth } from '../lessons/navigation/odometry'
import { obstacleAvoidanceBraitenbergVehicles, obstacleAvoidanceReactiveRules, obstacleAvoidanceWallFollowing } from '../lessons/navigation/obstacle-avoidance'
import { mazeSolvingFloodFill, mazeSolvingMicromouse, mazeSolvingWallFollower } from '../lessons/navigation/maze-solving'
import { graphSearchAHeuristic, graphSearchDLite, graphSearchGridMaps } from '../lessons/navigation/graph-search'
import { samplingPlannersRrtGrowth, samplingPlannersSmoothingPaths } from '../lessons/navigation/sampling-planners'
import { pathTrackingPurePursuit, pathTrackingStanleyController } from '../lessons/navigation/path-tracking'
import { localizationParticleFilter, localizationScanMatching } from '../lessons/navigation/localization'
import { slamLoopClosure, slamPoseGraphs, slamTheChickenAndEggProblem } from '../lessons/navigation/slam'
import { swarmMultiRobotFlocking, swarmMultiRobotTaskAllocation } from '../lessons/navigation/swarm-multi-robot'
import { neuralNets101GradientDescent, neuralNets101Overfitting, neuralNets101Perceptron } from '../lessons/ai/neural-nets-101'
import { tinymlGestureRecognition, tinymlQuantization } from '../lessons/ai/tinyml'
import { speechWakeWordsKeywordSpotting, speechWakeWordsVoiceCommands } from '../lessons/ai/speech-wake-words'
import { anomalyDetectionThresholdsVsModels, anomalyDetectionVibrationBaselines } from '../lessons/ai/anomaly-detection'
import { newtonsLawsFMA, newtonsLawsFreeBodyDiagrams, newtonsLawsFriction } from '../lessons/mechanics/newton-s-laws'
import { kinematicsConstantAcceleration, kinematicsProjectileMotion, kinematicsVelocityTime } from '../lessons/mechanics/kinematics'
import { torqueLeversLeverTypes, torqueLeversMomentArm, torqueLeversStaticBalance } from '../lessons/mechanics/torque-levers'
import { rotationAngularMomentum, rotationFlywheel, rotationMomentOfInertia } from '../lessons/mechanics/rotation'
import { energyWorkEfficiency, energyWorkKineticAndPotential, energyWorkWorkAndPower } from '../lessons/mechanics/energy-work'
import { frictionTractionRollingResistance, frictionTractionStaticVsKinetic, frictionTractionWheelSlip } from '../lessons/mechanics/friction-traction'
import { oscillationsDamping, oscillationsResonance, oscillationsSpringMass } from '../lessons/mechanics/oscillations'
import { collisionsBumpSensors, collisionsElasticAndInelastic } from '../lessons/mechanics/collisions'
import { centreOfMassLowAndWide, centreOfMassTippingAngle } from '../lessons/mechanics/centre-of-mass'
import { vibrationDampingMounts, vibrationMotorVibration } from '../lessons/mechanics/vibration'
import { soundUltrasoundDoppler, soundUltrasoundEchoRanging, soundUltrasoundSpeedOfSound } from '../lessons/waves/sound-ultrasound'
import { lightOpticsLensesAndFocus, lightOpticsReflection, lightOpticsRefraction } from '../lessons/waves/light-optics'
import { infraredThermalBlackBodyRadiation, infraredThermalThermalCamera } from '../lessons/waves/infrared-thermal'
import { electromagneticSpectrumWavelengthAndFrequency, electromagneticSpectrumWhereSensorsLive } from '../lessons/waves/electromagnetic-spectrum'
import { pressureFluidsBarometerAltitude, pressureFluidsBernoulli } from '../lessons/waves/pressure-fluids'
import { gravityInertiaAccelerometerReading, gravityInertiaFreeFall } from '../lessons/waves/gravity-inertia'
import { heatTransferCoolingARegulator, heatTransferThermalResistance } from '../lessons/waves/heat-transfer'
import { vectorsCrossProduct, vectorsDotProduct, vectorsProjection } from '../lessons/math/vectors'
import { matricesInverse, matricesMatrixMultiply, matricesRotationMatrix } from '../lessons/math/matrices'
import { trigonometryAtan2, trigonometryLawOfCosines, trigonometryUnitCircle } from '../lessons/math/trigonometry'
import { quaternionsGimbalLock, quaternionsQuaternionRotate, quaternionsSlerp } from '../lessons/math/quaternions'
import { calculusDerivativeAsSlope, calculusIntegralAsArea, calculusNumericalIntegration } from '../lessons/math/calculus'
import { probabilityBayesRule, probabilityGaussianNoise, probabilityVariance } from '../lessons/math/probability'
import { linearAlgebraEigenvectors, linearAlgebraLeastSquares } from '../lessons/math/linear-algebra'
import { differentialEquationsEulerIntegration, differentialEquationsStepSize } from '../lessons/math/differential-equations'
import { signalsSampleRate, signalsZTransformIntuition } from '../lessons/math/signals'
import { bearingsBallBearings, bearingsBushings } from '../lessons/materials/bearings'
import { fastenersHeatSetInserts, fastenersMetricSizes, fastenersThreadLocker } from '../lessons/materials/fasteners'
import { laserCncAcrylicVsPlywood, laserCncKerf } from '../lessons/materials/laser-cnc'
import { stressStrainHookesLaw, stressStrainSafetyFactor, stressStrainYieldStrength } from '../lessons/materials/stress-strain'
import { reinforcementLearningQLearningGridworld, reinforcementLearningRewardAndPolicy, reinforcementLearningSimToReal } from '../lessons/ai/reinforcement-learning'
import { imitationLearningBehaviourCloning, imitationLearningDataCollection } from '../lessons/ai/imitation-learning'
import { visionLanguageModelsGroundingObjects, visionLanguageModelsTaskPlanning } from '../lessons/ai/vision-language-models'
import { closingTheLoop, deadReckoningDrift } from '../lessons/control/open-vs-closed-loop'
import { physics } from './physics'
import { practice } from './practice'
import { robotics } from './robotics'
import { Category, Entry, Topic } from './types'

export const CATEGORIES: Category[] = [...electronics, ...robotics, ...physics, ...practice]

export const LEARN = CATEGORIES.filter((c) => c.group === 'learn')

const SECTION_IDS: [title: string, ids: string[]][] = [
  ['Electronics', ['electricity', 'components', 'semiconductors', 'digital', 'power', 'signals']],
  ['Embedded', ['microcontrollers', 'sensors', 'software']],
  ['Robotics', ['actuators', 'mobility', 'control', 'kinematics', 'perception', 'navigation', 'ai']],
  ['Physics & maths', ['mechanics', 'waves', 'math']],
  ['Making', ['materials', 'printing']],
]
export const SECTIONS = SECTION_IDS.map(([title, ids]) => ({ title, categories: ids.map((id) => LEARN.find((c) => c.id === id)!) }))
export const PRACTICE = CATEGORIES.filter((c) => c.group === 'practice')

const READY: Record<string, Lesson> = {
  'electricity/current/what-flows-in-a-wire': whatFlows,
  'electricity/current/conventional-vs-electron-flow': conventionalVsElectron,
  'electricity/current/amps-and-the-coulomb': ampsAndCoulomb,
  'electricity/voltage/potential-difference': potentialDifference,
  'electricity/voltage/ground-and-reference': groundAndReference,
  'electricity/voltage/measuring-with-a-multimeter': measuringWithMultimeter,
  'electricity/resistance/resistivity-and-wire-gauge': resistivityAndGauge,
  'electricity/resistance/temperature-effects': temperatureEffects,
  'electricity/resistance/reading-resistor-bands': readingResistorBands,
  'electricity/ohm-s-law/v-i-r': vEqualsIR,
  'electricity/ohm-s-law/solving-a-loop': solvingALoop,
  'electricity/ohm-s-law/ohm-plot': ohmPlot,
  'electricity/power-energy/p-v-i': pEqualsVI,
  'electricity/power-energy/heat-in-a-resistor': heatInAResistor,
  'electricity/power-energy/wh-and-mah': whAndMah,
  'electricity/series-parallel/series-resistors': seriesResistors,
  'electricity/series-parallel/parallel-resistors': parallelResistors,
  'electricity/series-parallel/cells-in-series-and-parallel': cellsSeriesParallel,
  'electricity/series-parallel/mixed-networks': mixedNetworks,
  'electricity/voltage-divider/the-divider-formula': dividerFormula,
  'electricity/voltage-divider/loading-a-divider': loadingDivider,
  'electricity/voltage-divider/divider-as-a-sensor-input': dividerSensor,
  'electricity/kirchhoff-s-laws/kcl-at-a-node': kclAtANode,
  'electricity/kirchhoff-s-laws/kvl-around-a-loop': kvlAroundALoop,
  'electricity/kirchhoff-s-laws/nodal-analysis': nodalAnalysis,
  'electricity/thevenin-norton/thevenin-equivalent': theveninEquivalent,
  'electricity/thevenin-norton/maximum-power-transfer': maximumPowerTransfer,
  'electricity/ac-vs-dc/sine-waves-and-rms': sineAndRms,
  'electricity/ac-vs-dc/frequency-and-period': frequencyAndPeriod,
  'electricity/ac-vs-dc/mains-vs-battery': mainsVsBattery,
  'electricity/electric-fields/coulomb-force': coulombLaw,
  'electricity/electric-fields/field-lines': fieldLineMap,
  'electricity/electric-fields/capacitance-from-plates': capacitanceFromPlates,
  'electricity/magnetism/wire-and-compass': wireAndCompass,
  'electricity/magnetism/solenoid': solenoid,
  'electricity/magnetism/right-hand-rule': rightHandRule,
  'electricity/magnetism/induction': induction,
  'components/resistor/value-and-tolerance': valueAndTolerance,
  'components/resistor/power-rating': powerRating,
  'components/resistor/pull-up-and-pull-down': pullUpAndPullDown,
  'components/capacitor/charging-and-discharging': chargingAndDischarging,
  'components/capacitor/rc-time-constant': rcTimeConstant,
  'components/capacitor/decoupling': decoupling,
  'components/capacitor/electrolytic-vs-ceramic': electrolyticVsCeramic,
  'components/inductor/energy-in-a-coil': energyInACoil,
  'components/inductor/rl-time-constant': rlTimeConstant,
  'components/inductor/flyback-spike': flybackSpike,
  'components/diode/forward-drop': forwardDrop,
  'components/diode/reverse-blocking': reverseBlocking,
  'components/diode/flyback-diode': flybackDiode,
  'components/diode/zener-clamp': zenerClamp,
  'components/led/forward-voltage-and-colour': forwardVoltageAndColour,
  'components/led/current-limiting-resistor': currentLimitingResistor,
  'components/led/rgb-led': rgbLed,
  'components/led/led-matrix': ledMatrix,
  'components/transistor-bjt/npn-as-a-switch': npnAsASwitch,
  'components/transistor-bjt/gain-and-saturation': gainAndSaturation,
  'components/transistor-bjt/base-resistor': baseResistor,
  'components/mosfet/gate-threshold': gateThreshold,
  'components/mosfet/low-side-switching': lowSideSwitching,
  'components/mosfet/logic-level-mosfets': logicLevelMosfets,
  'components/mosfet/gate-drive': gateDrive,
  'components/relay/coil-and-contacts': coilAndContacts,
  'components/relay/driving-a-relay': drivingARelay,
  'components/relay/solid-state-relay': solidStateRelay,
  'components/switches-buttons/contact-bounce': contactBounce,
  'components/switches-buttons/debouncing': debouncing,
  'components/switches-buttons/toggle-vs-momentary': toggleVsMomentary,
  'components/potentiometer/wiper-as-divider': wiperAsDivider,
  'components/potentiometer/linear-vs-log-taper': linearVsLogTaper,
  'components/fuses-protection/fuse-ratings': fuseRatings,
  'components/fuses-protection/reverse-polarity-protection': reversePolarity,
  'components/fuses-protection/tvs-diode': tvsDiode,
  'components/crystal-oscillator/resonance': resonance,
  'components/crystal-oscillator/load-capacitors': loadCapacitors,
  'components/crystal-oscillator/clock-accuracy': clockAccuracy,
  'components/op-amp/ideal-rules': idealRules,
  'components/op-amp/inverting-amplifier': invertingAmplifier,
  'components/op-amp/voltage-follower': voltageFollower,
  'components/op-amp/comparator': comparator,
  'components/voltage-regulators/linear-ldo': linearLdo,
  'components/voltage-regulators/dropout-and-heat': dropoutAndHeat,
  'components/voltage-regulators/buck-converter': buckConverter,
  'components/voltage-regulators/boost-converter': boostConverter,
  'semiconductors/silicon-doping/band-gap': bandGap,
  'semiconductors/silicon-doping/n-type-and-p-type': nAndPType,
  'semiconductors/silicon-doping/holes-and-electrons': holesAndElectrons,
  'semiconductors/pn-junction/depletion-region': depletionRegion,
  'semiconductors/pn-junction/forward-and-reverse-bias': forwardAndReverseBias,
  'semiconductors/pn-junction/breakdown': breakdown,
  'semiconductors/mosfet-physics/channel-formation': channelFormation,
  'semiconductors/mosfet-physics/cmos-inverter': cmosInverterLesson,
  'semiconductors/mosfet-physics/switching-energy': switchingEnergyLesson,
  'semiconductors/logic-gates/nand-from-transistors': nandFromTransistors,
  'semiconductors/logic-gates/truth-tables': truthTables,
  'semiconductors/logic-gates/adders': adders,
  'semiconductors/memory-cell/sram-latch': sramLatch,
  'semiconductors/memory-cell/dram-capacitor': dramCapacitor,
  'semiconductors/memory-cell/flash-floating-gate': flashFloatingGate,
  'digital/binary-hex/binary-counting': binaryCounting,
  'digital/binary-hex/hex-shorthand': hexShorthand,
  'digital/binary-hex/two-s-complement': twosComplement,
  'digital/combinational-logic/truth-tables': tableToCircuit,
  'digital/combinational-logic/multiplexer': multiplexer,
  'digital/combinational-logic/decoder': decoder,
  'digital/combinational-logic/half-and-full-adder': halfAndFullAdder,
  'digital/flip-flops-latches/sr-latch': srLatch,
  'digital/flip-flops-latches/d-flip-flop': dFlipFlop,
  'digital/flip-flops-latches/registers': registers,
  'digital/counters-shift-registers/ripple-counter': rippleCounter,
  'digital/counters-shift-registers/shift-register': shiftRegister,
  'digital/counters-shift-registers/74hc595-output-expander': hc595,
  'digital/state-machines/moore-vs-mealy': mooreVsMealy,
  'digital/state-machines/traffic-light-fsm': trafficLight,
  'digital/state-machines/robot-behaviour-fsm': robotBehaviour,
  'digital/timing/propagation-delay': propagationDelay,
  'digital/timing/metastability': metastability,
  'digital/timing/clock-dividers': clockDividers,
  'digital/level-shifting/logic-thresholds': logicThresholds,
  'digital/level-shifting/divider-shifter': dividerShifter,
  'digital/level-shifting/bidirectional-shifter': bidirectionalShifter,
  'digital/fpga-basics/luts': luts,
  'digital/fpga-basics/blinky-in-hardware': blinkyInHardware,
  'semiconductors/chip-making/lithography-machine': lithographyMachine,
  'semiconductors/chip-making/wafer-to-chip': waferToChip,
  'semiconductors/chip-making/what-3-nm-means': what3nmMeans,
  'power/battery-chemistry/cell-voltage-curve': cellVoltageCurve,
  'power/battery-chemistry/capacity-and-c-rate': capacityAndCRate,
  'power/battery-chemistry/internal-resistance': internalResistance,
  'power/18650-packs/1s-to-4s': oneSToFourS,
  'power/18650-packs/bms-protection': bmsProtection,
  'power/18650-packs/balancing': balancing,
  'power/charging/tp4056': tp4056,
  'power/charging/charge-curve': chargeCurveLesson,
  'power/charging/thermal-limits': thermalLimits,
  'power/buck-boost/inductor-ripple': inductorRipple,
  'power/buck-boost/efficiency': efficiency,
  'power/buck-boost/choosing-a-module': choosingAModule,
  'power/power-budget/add-up-the-loads': addUpTheLoads,
  'power/power-budget/runtime-estimate': runtimeEstimate,
  'power/power-budget/peak-vs-average': peakVsAverage,
  'power/wiring-gauge/voltage-drop': voltageDrop,
  'power/wiring-gauge/connector-ratings': connectorRatings,
  'power/wiring-gauge/star-ground': starGround,
  'power/noise-decoupling/motor-noise': motorNoise,
  'power/noise-decoupling/bulk-capacitors': bulkCapacitors,
  'power/noise-decoupling/separate-rails': separateRails,
  'power/brownouts/current-spikes': currentSpikes,
  'power/brownouts/diagnosing-resets': diagnosingResets,
  'signals/filters/rc-low-pass': rcLowPass,
  'signals/filters/high-pass': highPass,
  'signals/filters/bode-plot': bodePlot,
  'signals/fourier-intuition/spectrum': spectrum,
  'signals/fourier-intuition/aliasing': aliasing,
  'signals/fourier-intuition/nyquist': nyquistLimit,
  'signals/oscilloscope/triggering': triggering,
  'signals/oscilloscope/probing': probing,
  'signals/oscilloscope/decoding-a-bus': decodingBus,
  'signals/logic-analyzer/sample-rate': sampleRate,
  'signals/logic-analyzer/pattern-trigger': patternTrigger,
  'signals/logic-analyzer/capture-i2c': captureI2c,
  'signals/logic-analyzer/capture-spi': captureSpi,
  'signals/transmission-lines/reflections': reflections,
  'signals/transmission-lines/termination': termination,
  'signals/radio-basics/2-4-ghz': twoFourGhz,
  'signals/radio-basics/antenna-types': antennaTypes,
  'signals/radio-basics/lora': lora,
  'signals/grounding-shielding/ground-loops': groundLoops,
  'signals/grounding-shielding/twisted-pairs': twistedPairs,
  'signals/grounding-shielding/cable-shields': cableShields,
  'signals/pcb-design/schematic-capture': schematicCapture,
  'signals/pcb-design/layout-rules': layoutRules,
  'signals/pcb-design/traces-and-vias': tracesAndVias,
  'signals/pcb-design/manufacturing': manufacturing,
  'microcontrollers/gpio/output-and-input-modes': outputAndInputModes,
  'microcontrollers/gpio/pull-ups': pullUps,
  'microcontrollers/gpio/drive-strength': driveStrength,
  'microcontrollers/gpio/interrupts': interrupts,
  'microcontrollers/pwm/duty-cycle': dutyCycle,
  'microcontrollers/pwm/frequency-choice': frequencyChoice,
  'microcontrollers/pwm/servo-pulses': servoPulses,
  'microcontrollers/pwm/average-voltage': averageVoltage,
  'microcontrollers/adc/resolution-and-range': resolutionAndRange,
  'microcontrollers/adc/sampling': sampling,
  'microcontrollers/adc/noise-and-averaging': noiseAndAveraging,
  'microcontrollers/adc/esp32-adc-quirks': esp32AdcQuirks,
  'microcontrollers/dac/r-2r-ladder': r2rLadder,
  'microcontrollers/dac/audio-out': audioOut,
  'microcontrollers/timers-interrupts/hardware-timers': hardwareTimers,
  'microcontrollers/timers-interrupts/isr-rules': isrRules,
  'microcontrollers/timers-interrupts/millis-without-delay': millisWithoutDelay,
  'microcontrollers/uart-serial/framing-and-baud': framingAndBaud,
  'microcontrollers/uart-serial/level-and-noise': levelAndNoise,
  'microcontrollers/uart-serial/gps-and-modules': gpsAndModules,
  'microcontrollers/i2c/addresses': addresses,
  'microcontrollers/i2c/pull-up-resistors': pullUpResistors,
  'microcontrollers/i2c/reading-an-imu': readingAnImu,
  'microcontrollers/i2c/bus-scan': busScan,
  'microcontrollers/spi/clock-modes': clockModes,
  'microcontrollers/spi/chip-select': chipSelect,
  'microcontrollers/spi/sd-cards-and-displays': sdCardsAndDisplays,
  'microcontrollers/can-bus/differential-signalling': differentialSignalling,
  'microcontrollers/can-bus/arbitration': arbitration,
  'microcontrollers/wi-fi-bluetooth/station-and-ap': stationAndAp,
  'microcontrollers/wi-fi-bluetooth/http-and-websocket': httpAndWebSocket,
  'microcontrollers/wi-fi-bluetooth/ble-gatt': bleGatt,
  'microcontrollers/wi-fi-bluetooth/esp-now': espNow,
  'microcontrollers/power-modes/deep-sleep': deepSleep,
  'microcontrollers/power-modes/wake-sources': wakeSources,
  'microcontrollers/power-modes/battery-budget': batteryBudget,
  'microcontrollers/memory-storage/flash-layout': flashLayout,
  'microcontrollers/memory-storage/stack-and-heap': stackAndHeap,
  'microcontrollers/memory-storage/littlefs': littleFs,
  'microcontrollers/rtos-basics/tasks-and-priorities': tasksAndPriorities,
  'microcontrollers/rtos-basics/queues': queues,
  'microcontrollers/rtos-basics/mutexes': mutexes,
  'microcontrollers/bootloader-flashing/boot-modes': bootModes,
  'microcontrollers/bootloader-flashing/ota-updates': otaUpdates,
  'sensors/ultrasonic/time-of-flight': timeOfFlight,
  'sensors/ultrasonic/beam-angle': beamAngle,
  'sensors/ultrasonic/soft-target-errors': softTargetErrors,
  'sensors/infrared/obstacle-sensor': obstacleSensor,
  'sensors/infrared/line-follower': lineFollower,
  'sensors/infrared/sunlight-interference': sunlightInterference,
  'sensors/time-of-flight-laser/vl53l0x': vl53l0x,
  'sensors/time-of-flight-laser/multi-zone-ranging': multiZoneRanging,
  'sensors/lidar/2d-scan': scan2d,
  'sensors/lidar/point-clouds': pointClouds,
  'sensors/lidar/resolution-and-range': rangeAndResolution,
  'sensors/encoder/quadrature': quadrature,
  'sensors/encoder/counts-per-revolution': countsPerRevolution,
  'sensors/encoder/speed-from-ticks': speedFromTicks,
  'sensors/imu/accelerometer': accelerometer,
  'sensors/imu/gyroscope': gyroscope,
  'sensors/imu/complementary-filter': complementaryFilter,
  'sensors/imu/drift': drift,
  'sensors/magnetometer/heading': heading,
  'sensors/magnetometer/hard-iron-calibration': hardIronCalibration,
  'sensors/gps/trilateration': trilateration,
  'sensors/gps/fix-and-accuracy': fixAndAccuracy,
  'sensors/gps/rtk': rtk,
  'sensors/camera/rolling-vs-global-shutter': rollingVsGlobalShutter,
  'sensors/camera/exposure': exposure,
  'sensors/camera/lens-distortion': lensDistortion,
  'sensors/temperature-humidity/thermistor-curve': thermistorCurve,
  'sensors/temperature-humidity/one-wire-protocol': oneWireProtocol,
  'sensors/current-voltage-sensing/shunt-resistor': shuntResistor,
  'sensors/current-voltage-sensing/ina219': ina219,
  'sensors/current-voltage-sensing/state-of-charge': stateOfCharge,
  'sensors/force-touch/strain-gauge': strainGauge,
  'sensors/force-touch/capacitive-touch': capacitiveTouch,
  'sensors/microphone-sound/mems-mic': memsMic,
  'sensors/microphone-sound/sound-source-direction': soundSourceDirection,
  'sensors/sensor-fusion/why-fuse': whyFuse,
  'sensors/sensor-fusion/complementary-filter': complementaryHeading,
  'sensors/sensor-fusion/kalman-intuition': kalmanIntuition,
  'software/firmware-structure/super-loop-vs-rtos': superLoopVsRtos,
  'software/firmware-structure/hardware-abstraction': hardwareAbstraction,
  'software/firmware-structure/fixed-rate-control-loop': fixedRateControlLoop,
  'software/ros-2-concepts/publish-and-subscribe': publishAndSubscribe,
  'software/ros-2-concepts/services-and-actions': servicesAndActions,
  'software/ros-2-concepts/launch-files': launchFiles,
  'software/tf-urdf/frame-tree': frameTree,
  'software/tf-urdf/writing-a-urdf': writingAUrdf,
  'software/nav2/costmaps': costmaps,
  'software/nav2/behaviour-trees': behaviourTrees,
  'software/micro-ros/agent-and-client': agentAndClient,
  'software/micro-ros/serial-transport': serialTransport,
  'software/simulation/physics-engine': physicsEngine,
  'software/simulation/sim-to-real-gap': simToRealGap,
  'software/behaviour-trees/sequence-and-fallback': sequenceAndFallback,
  'software/behaviour-trees/blackboard': blackboard,
  'software/telemetry-logging/plotting-live-data': plottingLiveData,
  'software/telemetry-logging/replay-logs': replayLogs,
  'software/remote-control/joystick-over-ble': joystickOverBle,
  'software/remote-control/websocket-control': webSocketControl,
  'software/remote-control/latency': latency,
  'software/safety-failsafes/watchdog': watchdog,
  'software/safety-failsafes/e-stop': eStop,
  'software/safety-failsafes/fault-states': faultStates,
  'actuators/dc-motor/back-emf': backEmfLesson,
  'actuators/dc-motor/torque-and-speed-curve': torqueAndSpeedCurve,
  'actuators/dc-motor/stall-current': stallCurrent,
  'actuators/dc-motor/gearboxes': gearboxes,
  'actuators/h-bridge/four-switches': fourSwitches,
  'actuators/h-bridge/l298n-vs-modern-drivers': l298nVsModernDrivers,
  'actuators/h-bridge/decay-modes': decayModes,
  'actuators/h-bridge/shoot-through': shootThroughLesson,
  'actuators/servo/pulse-to-angle': pulseToAngle,
  'actuators/servo/inside-a-hobby-servo': insideAHobbyServo,
  'actuators/servo/jitter-and-power': jitterAndPower,
  'actuators/stepper/full-half-and-micro-steps': fullHalfAndMicroSteps,
  'actuators/stepper/a4988-and-tmc-drivers': a4988AndTmcDrivers,
  'actuators/stepper/missed-steps': missedSteps,
  'actuators/brushless-bldc/three-phase-drive': threePhaseDrive,
  'actuators/brushless-bldc/hall-sensors': hallSensors,
  'actuators/brushless-bldc/esc-basics': escBasics,
  'actuators/field-oriented-control/clarke-and-park': clarkeAndPark,
  'actuators/field-oriented-control/current-loops': currentLoops,
  'actuators/linear-actuators/lead-screw': leadScrewLesson,
  'actuators/linear-actuators/limit-switches': limitSwitches,
  'actuators/solenoids-pumps/solenoid-drive': solenoidDrive,
  'actuators/solenoids-pumps/peristaltic-pump': peristalticPump,
  'actuators/gear-trains/gear-ratio': gearRatioLesson,
  'actuators/gear-trains/backlash': backlash,
  'actuators/gear-trains/planetary-gears': planetaryGears,
  'actuators/gear-trains/worm-drive': wormDrive,
  'actuators/pneumatics-soft-robots/pneumatic-cylinder': pneumaticCylinder,
  'actuators/pneumatics-soft-robots/soft-gripper': softGripper,
  'actuators/motor-selection/torque-budget': torqueBudgetLesson,
  'actuators/motor-selection/duty-cycle': dutyCycleLesson,
  'actuators/motor-selection/thermal-limits': thermalLimitsLesson,
  'mobility/differential-drive/turn-radius': turnRadiusLesson,
  'mobility/differential-drive/odometry': odometryLesson,
  'mobility/differential-drive/slip': slipLesson,
  'mobility/mecanum-wheels/roller-geometry': rollerGeometry,
  'mobility/mecanum-wheels/strafe-maths': strafeMaths,
  'mobility/mecanum-wheels/why-they-slip': whyTheySlip,
  'mobility/omni-swerve/omni-wheels': omniWheelsLesson,
  'mobility/omni-swerve/swerve-module': swerveModule,
  'mobility/ackermann-steering/steering-geometry': steeringGeometry,
  'mobility/ackermann-steering/bicycle-model': bicycleModel,
  'mobility/tracks-terrain/skid-steer': skidSteer,
  'mobility/tracks-terrain/traction': tractionLesson,
  'mobility/legged-walking/gait-cycle': gaitCycle,
  'mobility/legged-walking/zero-moment-point': zeroMomentPoint,
  'mobility/legged-walking/leg-ik': legIk,
  'mobility/balancing-robots/why-it-falls': whyItFalls,
  'mobility/balancing-robots/tilt-pid': tiltPid,
  'mobility/balancing-robots/self-balancing-car': selfBalancingCar,
  'mobility/drones-flight/quadcopter-mixing': quadcopterMixing,
  'mobility/drones-flight/attitude-control': attitudeControl,
  'mobility/underwater-swimming/buoyancy': buoyancyLesson,
  'mobility/underwater-swimming/thruster-layout': thrusterLayout,
  'control/open-vs-closed-loop/dead-reckoning-drift': deadReckoningDrift,
  'control/open-vs-closed-loop/closing-the-loop': closingTheLoop,
  'control/bang-bang-hysteresis/thermostat': thermostat,
  'control/bang-bang-hysteresis/chatter': chatter,
  'control/pid/proportional-only': proportionalOnly,
  'control/pid/integral-windup': integralWindup,
  'control/pid/derivative-kick': derivativeKick,
  'control/pid/tuning-by-hand': tuningByHand,
  'control/pid/ziegler-nichols': zieglerNicholsLesson,
  'control/speed-control/encoder-feedback': encoderFeedback,
  'control/speed-control/feed-forward': feedForward,
  'control/speed-control/velocity-pid': velocityPid,
  'control/position-control/trapezoid-profile': trapezoidProfile,
  'control/position-control/s-curve': sCurve,
  'control/line-following/error-from-sensors': errorFromSensors,
  'control/line-following/pd-steering': pdSteering,
  'control/line-following/intersections': intersections,
  'control/stability/poles-and-damping': polesAndDamping,
  'control/stability/step-response': stepResponse,
  'control/stability/gain-and-phase-margin': gainAndPhaseMargin,
  'control/state-space-lqr/state-vector': stateVector,
  'control/state-space-lqr/lqr-intuition': lqrIntuition,
  'control/model-predictive-control/receding-horizon': recedingHorizon,
  'control/model-predictive-control/constraints': mpcConstraints,
  'control/filters-in-the-loop/moving-average': movingAverage,
  'control/filters-in-the-loop/low-pass': lowPass,
  'control/filters-in-the-loop/kalman-filter': kalmanFilter,
  'kinematics/coordinate-frames/2d-rotation': rotation2d,
  'kinematics/coordinate-frames/homogeneous-transforms': homogeneousTransforms,
  'kinematics/coordinate-frames/frame-tree': coordFrameTree,
  'kinematics/forward-kinematics/two-link-arm': twoLinkArm,
  'kinematics/forward-kinematics/denavit-hartenberg': denavitHartenberg,
  'kinematics/inverse-kinematics/analytic-ik': analyticIk,
  'kinematics/inverse-kinematics/multiple-solutions': multipleSolutions,
  'kinematics/inverse-kinematics/jacobian-method': jacobianMethod,
  'kinematics/jacobian/singularities': jacobianSingularities,
  'kinematics/jacobian/manipulability': jacobianManipulability,
  'kinematics/workspace/reach-envelope': workspaceReach,
  'kinematics/workspace/dexterity': workspaceDexterity,
  'kinematics/trajectories/linear-interpolation': trajectoriesLinear,
  'kinematics/trajectories/splines': trajectoriesSplines,
  'kinematics/trajectories/time-scaling': trajectoriesTimeScaling,
  'kinematics/grippers/parallel-jaw': grippersParallelJaw,
  'kinematics/grippers/suction': grippersSuction,
  'kinematics/grippers/compliance': grippersCompliance,
  'kinematics/robot-arm-build/assemble-the-arm': armBuildAssemble,
  'kinematics/robot-arm-build/drive-it-with-ik': armBuildDriveIk,
  'kinematics/dynamics/gravity-torque': dynamicsGravityTorque,
  'kinematics/dynamics/inertia': dynamicsInertia,
  'kinematics/dynamics/payload-limits': dynamicsPayloadLimits,
  'perception/image-basics/rgb-and-hsv': imageBasicsRgbHsv,
  'perception/image-basics/thresholding': imageBasicsThresholding,
  'perception/image-basics/histogram': imageBasicsHistogram,
  'perception/edges-features/convolution': edgesFeaturesConvolution,
  'perception/edges-features/canny-edges': edgesFeaturesCannyEdges,
  'perception/edges-features/corners': edgesFeaturesCorners,
  'perception/colour-tracking/hsv-mask': colourTrackingHsvMask,
  'perception/colour-tracking/centroid-steering': colourTrackingCentroidSteering,
  'perception/camera-model/pinhole-model': cameraModelPinholeModel,
  'perception/camera-model/calibration': cameraModelCalibration,
  'perception/camera-model/stereo-depth': cameraModelStereoDepth,
  'perception/fiducial-markers/detecting-a-tag': fiducialMarkersDetectingATag,
  'perception/fiducial-markers/pose-from-a-tag': fiducialMarkersPoseFromATag,
  'perception/object-detection/yolo-idea': objectDetectionYoloIdea,
  'perception/object-detection/running-on-an-esp32-cam': objectDetectionRunningOnAnEsp32Cam,
  'perception/object-detection/edge-accelerators': objectDetectionEdgeAccelerators,
  'perception/depth-sensing/depth-map': depthSensingDepthMap,
  'perception/depth-sensing/point-cloud': depthSensingPointCloud,
  'perception/optical-flow/lucas-kanade': opticalFlowLucasKanade,
  'perception/optical-flow/visual-odometry': opticalFlowVisualOdometry,
  'perception/occupancy-grids/ray-casting': occupancyGridsRayCasting,
  'perception/occupancy-grids/log-odds-update': occupancyGridsLogOddsUpdate,
  'navigation/odometry/dead-reckoning': odometryDeadReckoning,
  'navigation/odometry/error-growth': odometryErrorGrowth,
  'navigation/odometry/calibrating-wheel-size': odometryCalibratingWheelSize,
  'navigation/obstacle-avoidance/reactive-rules': obstacleAvoidanceReactiveRules,
  'navigation/obstacle-avoidance/braitenberg-vehicles': obstacleAvoidanceBraitenbergVehicles,
  'navigation/obstacle-avoidance/wall-following': obstacleAvoidanceWallFollowing,
  'navigation/maze-solving/wall-follower': mazeSolvingWallFollower,
  'navigation/maze-solving/flood-fill': mazeSolvingFloodFill,
  'navigation/maze-solving/micromouse': mazeSolvingMicromouse,
  'navigation/graph-search/grid-maps': graphSearchGridMaps,
  'navigation/graph-search/a-heuristic': graphSearchAHeuristic,
  'navigation/graph-search/d-lite': graphSearchDLite,
  'navigation/sampling-planners/rrt-growth': samplingPlannersRrtGrowth,
  'navigation/sampling-planners/smoothing-paths': samplingPlannersSmoothingPaths,
  'navigation/path-tracking/pure-pursuit': pathTrackingPurePursuit,
  'navigation/path-tracking/stanley-controller': pathTrackingStanleyController,
  'navigation/localization/particle-filter': localizationParticleFilter,
  'navigation/localization/scan-matching': localizationScanMatching,
  'navigation/slam/the-chicken-and-egg-problem': slamTheChickenAndEggProblem,
  'navigation/slam/loop-closure': slamLoopClosure,
  'navigation/slam/pose-graphs': slamPoseGraphs,
  'navigation/swarm-multi-robot/flocking': swarmMultiRobotFlocking,
  'navigation/swarm-multi-robot/task-allocation': swarmMultiRobotTaskAllocation,
  'ai/neural-nets-101/perceptron': neuralNets101Perceptron,
  'ai/neural-nets-101/gradient-descent': neuralNets101GradientDescent,
  'ai/neural-nets-101/overfitting': neuralNets101Overfitting,
  'ai/tinyml/quantization': tinymlQuantization,
  'ai/tinyml/gesture-recognition': tinymlGestureRecognition,
  'ai/reinforcement-learning/reward-and-policy': reinforcementLearningRewardAndPolicy,
  'ai/reinforcement-learning/q-learning-gridworld': reinforcementLearningQLearningGridworld,
  'ai/reinforcement-learning/sim-to-real': reinforcementLearningSimToReal,
  'ai/imitation-learning/behaviour-cloning': imitationLearningBehaviourCloning,
  'ai/imitation-learning/data-collection': imitationLearningDataCollection,
  'ai/vision-language-models/grounding-objects': visionLanguageModelsGroundingObjects,
  'ai/vision-language-models/task-planning': visionLanguageModelsTaskPlanning,
  'ai/speech-wake-words/keyword-spotting': speechWakeWordsKeywordSpotting,
  'ai/speech-wake-words/voice-commands': speechWakeWordsVoiceCommands,
  'ai/anomaly-detection/vibration-baselines': anomalyDetectionVibrationBaselines,
  'ai/anomaly-detection/thresholds-vs-models': anomalyDetectionThresholdsVsModels,
  'mechanics/newton-s-laws/f-m-a': newtonsLawsFMA,
  'mechanics/newton-s-laws/free-body-diagrams': newtonsLawsFreeBodyDiagrams,
  'mechanics/newton-s-laws/friction': newtonsLawsFriction,
  'mechanics/kinematics/constant-acceleration': kinematicsConstantAcceleration,
  'mechanics/kinematics/velocity-vs-time-plots': kinematicsVelocityTime,
  'mechanics/kinematics/projectile-motion': kinematicsProjectileMotion,
  'mechanics/torque-levers/moment-arm': torqueLeversMomentArm,
  'mechanics/torque-levers/lever-types': torqueLeversLeverTypes,
  'mechanics/torque-levers/static-balance': torqueLeversStaticBalance,
  'mechanics/rotation/moment-of-inertia': rotationMomentOfInertia,
  'mechanics/rotation/angular-momentum': rotationAngularMomentum,
  'mechanics/rotation/flywheel': rotationFlywheel,
  'mechanics/energy-work/kinetic-and-potential': energyWorkKineticAndPotential,
  'mechanics/energy-work/work-and-power': energyWorkWorkAndPower,
  'mechanics/energy-work/efficiency': energyWorkEfficiency,
  'mechanics/friction-traction/static-vs-kinetic': frictionTractionStaticVsKinetic,
  'mechanics/friction-traction/rolling-resistance': frictionTractionRollingResistance,
  'mechanics/friction-traction/wheel-slip': frictionTractionWheelSlip,
  'mechanics/oscillations/spring-mass': oscillationsSpringMass,
  'mechanics/oscillations/damping': oscillationsDamping,
  'mechanics/oscillations/resonance': oscillationsResonance,
  'mechanics/collisions/elastic-and-inelastic': collisionsElasticAndInelastic,
  'mechanics/collisions/bump-sensors': collisionsBumpSensors,
  'mechanics/centre-of-mass/tipping-angle': centreOfMassTippingAngle,
  'mechanics/centre-of-mass/low-and-wide': centreOfMassLowAndWide,
  'mechanics/vibration/motor-vibration': vibrationMotorVibration,
  'mechanics/vibration/damping-mounts': vibrationDampingMounts,
  'waves/sound-ultrasound/speed-of-sound': soundUltrasoundSpeedOfSound,
  'waves/sound-ultrasound/echo-ranging': soundUltrasoundEchoRanging,
  'waves/sound-ultrasound/doppler': soundUltrasoundDoppler,
  'waves/light-optics/reflection': lightOpticsReflection,
  'waves/light-optics/refraction': lightOpticsRefraction,
  'waves/light-optics/lenses-and-focus': lightOpticsLensesAndFocus,
  'waves/infrared-thermal/black-body-radiation': infraredThermalBlackBodyRadiation,
  'waves/infrared-thermal/thermal-camera': infraredThermalThermalCamera,
  'waves/electromagnetic-spectrum/wavelength-and-frequency': electromagneticSpectrumWavelengthAndFrequency,
  'waves/electromagnetic-spectrum/where-sensors-live': electromagneticSpectrumWhereSensorsLive,
  'waves/heat-transfer/thermal-resistance': heatTransferThermalResistance,
  'waves/heat-transfer/cooling-a-regulator': heatTransferCoolingARegulator,
  'waves/pressure-fluids/bernoulli': pressureFluidsBernoulli,
  'waves/pressure-fluids/barometer-altitude': pressureFluidsBarometerAltitude,
  'waves/gravity-inertia/free-fall': gravityInertiaFreeFall,
  'waves/gravity-inertia/accelerometer-reading': gravityInertiaAccelerometerReading,
  'math/vectors/dot-product': vectorsDotProduct,
  'math/vectors/cross-product': vectorsCrossProduct,
  'math/vectors/projection': vectorsProjection,
  'math/matrices/rotation-matrix': matricesRotationMatrix,
  'math/matrices/matrix-multiply': matricesMatrixMultiply,
  'math/matrices/inverse': matricesInverse,
  'math/trigonometry/unit-circle': trigonometryUnitCircle,
  'math/trigonometry/atan2': trigonometryAtan2,
  'math/trigonometry/law-of-cosines': trigonometryLawOfCosines,
  'math/quaternions/gimbal-lock': quaternionsGimbalLock,
  'math/quaternions/quaternion-rotate': quaternionsQuaternionRotate,
  'math/quaternions/slerp': quaternionsSlerp,
  'math/calculus/derivative-as-slope': calculusDerivativeAsSlope,
  'math/calculus/integral-as-area': calculusIntegralAsArea,
  'math/calculus/numerical-integration': calculusNumericalIntegration,
  'math/probability/gaussian-noise': probabilityGaussianNoise,
  'math/probability/bayes-rule': probabilityBayesRule,
  'math/probability/variance': probabilityVariance,
  'math/linear-algebra/least-squares': linearAlgebraLeastSquares,
  'math/linear-algebra/eigenvectors': linearAlgebraEigenvectors,
  'math/differential-equations/euler-integration': differentialEquationsEulerIntegration,
  'math/differential-equations/step-size': differentialEquationsStepSize,
  'math/signals/sample-rate': signalsSampleRate,
  'math/signals/z-transform-intuition': signalsZTransformIntuition,
  'materials/stress-strain/hooke-s-law': stressStrainHookesLaw,
  'materials/stress-strain/yield-strength': stressStrainYieldStrength,
  'materials/stress-strain/safety-factor': stressStrainSafetyFactor,
  'materials/laser-cnc/kerf': laserCncKerf,
  'materials/laser-cnc/acrylic-vs-plywood': laserCncAcrylicVsPlywood,
  'materials/fasteners/metric-sizes': fastenersMetricSizes,
  'materials/fasteners/heat-set-inserts': fastenersHeatSetInserts,
  'materials/fasteners/thread-locker': fastenersThreadLocker,
  'materials/bearings/ball-bearings': bearingsBallBearings,
  'materials/bearings/bushings': bearingsBushings,
}
for (const e of CATEGORIES.flatMap((c) => c.topics.flatMap((t) => t.entries))) e.lesson = READY[e.id]

export const readyCount = (t: Topic) => t.entries.filter((e) => e.lesson).length
export const topicCount = (c: Category) => c.topics.length
export const lessonCount = (c: Category) => c.topics.reduce((n, t) => n + t.entries.length, 0)

export interface Hit {
  category: Category
  topic: Topic
  entry?: Entry
}

export function search(q: string): Hit[] {
  const s = q.trim().toLowerCase()
  if (!s) return []
  const hits: Hit[] = []
  for (const category of CATEGORIES)
    for (const topic of category.topics) {
      if ((topic.title + ' ' + topic.tagline).toLowerCase().includes(s)) hits.push({ category, topic })
      for (const entry of topic.entries) if (entry.title.toLowerCase().includes(s)) hits.push({ category, topic, entry })
    }
  return hits.slice(0, 60)
}
