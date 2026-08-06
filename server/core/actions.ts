import {
  CONNECTION_CLASSES,
  LEGAL_ACTIONS,
  type ConnectionClass,
  type ConnectionState,
  type LegalActionRequest,
  type Quat,
  type Team,
  type Vec3,
  type WorkerPhase,
  type WorkerState,
} from "../../shared/core-protocol.js";
import { CorePhysicsWorld } from "./physics.js";
import { connectionClassSupportsFamilies } from "./connections.js";

export interface ActionEvent {
  text: string;
  actorId?: string | undefined;
  team?: Team | undefined;
  technical?: string | undefined;
}

const RAM_SADDLE_PITCH = 0;
const RAM_SADDLE_FORWARD = .52;
const RAM_SADDLE_HEIGHT = .19;
const RAM_BURST_FORCE_PER_WORKER = 2_100;
const HUB_SOCKET_REACH = .04;

interface WorkerRuntime {
  id: string;
  name: string;
  team: Team;
  phase: WorkerPhase;
  facing: Vec3;
  targetId: string | undefined;
  destination: Vec3 | undefined;
  action: LegalActionRequest["action"] | undefined;
  workPose: string | undefined;
}

interface CarryJointRecord {
  actorId: string;
  partAnchor: Vec3;
  handOffsetLocal?: Vec3;
  overstretchSeconds: number;
  heightOffset?: number;
}

interface CarryGroup {
  partId: string;
  actorIds: string[];
  joints: CarryJointRecord[];
  targetRotation: Quat;
  gripAngle?: number;
  gripTargetAngle?: number;
  releaseHeight?: number;
  supportsWeight?: boolean;
  assemblyBrace?: boolean;
  extendedRamReach?: boolean;
}

interface ActiveAction {
  request: LegalActionRequest;
  phase: "starting" | "approach" | "grasp" | "lift" | "transit" | "work" | "clear";
  phaseElapsed: number;
  totalElapsed: number;
  routes: Map<string, Vec3[]>;
  initialTargetPosition: Vec3 | undefined;
  initialTargetRotation: Quat | undefined;
  initialSecondaryPosition: Vec3 | undefined;
  initialSecondaryRotation: Quat | undefined;
  initialLoadPosition: Vec3 | undefined;
  workGoals: Map<string, Vec3> | undefined;
  transitGoals: Map<string, Vec3> | undefined;
  workVector: Vec3 | undefined;
  workPointLocal: Vec3 | undefined;
  stableSeconds: number;
  sawSupportContact: boolean;
  sawLoadContact: boolean;
  formationFollow: boolean;
  formationOffsets: Map<string, Vec3> | undefined;
  fulcrumBodyId: string | undefined;
  fulcrumPointLocal: Vec3 | undefined;
  fulcrumRelativeOffset: Vec3 | undefined;
  inProgressConnectionId: string | undefined;
  initialRopeLengths: Map<string, number> | undefined;
  lastRopeLengthUpdate: number;
}

export class CoreActionSystem {
  private readonly workers = new Map<string, WorkerRuntime>();
  private readonly queue: LegalActionRequest[] = [];
  private readonly reservations = new Map<string, string>();
  private readonly carrying = new Map<string, CarryGroup>();
  private readonly connections: ConnectionState[] = [];
  private active: ActiveAction | undefined;

  constructor(
    private readonly physics: CorePhysicsWorld,
    private readonly emit: (event: ActionEvent) => void,
    workerIds?: readonly string[],
  ) {
    for (const id of workerIds ?? physics.workerIds()) {
      const record = physics.records.get(id);
      if (!record?.team) continue;
      this.workers.set(id, {
        id,
        name: record.variant ?? id,
        team: record.team,
        phase: "idle",
        facing: physics.characterFacing(id) ?? { x: record.team === "king" ? 1 : -1, y: 0, z: 0 },
        targetId: undefined,
        destination: undefined,
        action: undefined,
        workPose: undefined,
      });
    }
  }

  submit(request: LegalActionRequest): { ok: boolean; message?: string } {
    const validation = this.validate(request);
    if (!validation.ok) return validation;
    this.queue.push(cloneRequest(request));
    return { ok: true };
  }

  enqueue(requests: LegalActionRequest[]): { ok: boolean; message?: string } {
    for (const request of requests) {
      const validation = this.validate(request, true);
      if (!validation.ok) return validation;
    }
    this.queue.push(...requests.map(cloneRequest));
    return { ok: true };
  }

  update(dt: number): void {
    this.updateCarryConstraints(dt);
    this.refreshRopeStates();
    if (!this.active) this.startNext();
    if (!this.active) return;
    this.active.phaseElapsed += dt;
    this.active.totalElapsed += dt;
    const action = this.active.request.action;
    if (action === "reserve") this.updateReserve();
    else if (action === "fetch" || action === "recover") this.updateFetch(dt);
    else if (action === "climb") this.updateClimb(dt);
    else if (action === "carry" || action === "assistCarry" || action === "stage") this.updateCarry(dt);
    else if (action === "release") this.updateRelease(dt);
    else if (action === "push" || action === "pull") this.updatePush(dt);
    else if (action === "operate") this.updateOperate(dt);
    else if (action === "strike") this.updateStrike(dt);
    else if (action === "align" || action === "turn") this.updateAlign(dt);
    else if (action === "connect" || action === "hookRope" || action === "reeveRope") {
      this.updateConnect(dt);
    }
    else if (action === "tension") this.updateTension(dt);
    else if (action === "hold" || action === "wait" || action === "test") this.updateTimed(dt);
    else if (action === "cancel") this.cancelActive("The order is cancelled.");
    else this.cancelActive(`${actionLabel(action)} is locked behind the connection gate.`);
  }

  states(): WorkerState[] {
    return [...this.workers.values()].map((worker) => {
      const state: WorkerState = {
        id: worker.id,
        name: worker.name,
        team: worker.team,
        phase: worker.phase,
        facing: { ...worker.facing },
      };
      if (worker.action) state.action = worker.action;
      if (worker.targetId) state.targetId = worker.targetId;
      if (worker.destination) state.destination = { ...worker.destination };
      if (worker.workPose) state.reservedWorkPose = worker.workPose;
      return state;
    });
  }

  connectionStates(): ConnectionState[] {
    return this.connections.map((connection) => ({ ...connection, actorIds: [...connection.actorIds] }));
  }

  isBusy(): boolean {
    return Boolean(this.active || this.queue.length > 0);
  }

  clearReservations(): void {
    this.reservations.clear();
  }

  activeDescription(): string | undefined {
    if (!this.active) return undefined;
    return `${this.active.request.action}:${this.active.phase}`;
  }

  cancelAll(text = "The autonomous order yields to direct control.", emitEvent = true): void {
    if (this.active) {
      this.cancelActive(text, emitEvent);
      return;
    }
    this.queue.length = 0;
    this.resetWorkers([...this.workers.keys()]);
  }

  private validate(
    request: LegalActionRequest,
    allowQueuedReservation = false,
  ): { ok: boolean; message?: string } {
    if (!LEGAL_ACTIONS.includes(request.action)) {
      return { ok: false, message: "That order is outside the legal action vocabulary." };
    }
    if (request.actorIds.length === 0) {
      return { ok: false, message: "Name at least one worker." };
    }
    const actors = request.actorIds.map((id) => this.workers.get(id));
    if (actors.some((actor) => !actor)) {
      return { ok: false, message: "One of those workers is not on the stage." };
    }
    if (new Set(request.actorIds).size !== request.actorIds.length) {
      return { ok: false, message: "A worker cannot fill two carry positions." };
    }
    if ((request.action === "operate" || request.action === "strike") && !request.targetId) {
      return { ok: false, message: `${actionLabel(request.action)} needs a visible target.` };
    }
    if (request.targetId) {
      const target = this.physics.records.get(request.targetId);
      if (!target) return { ok: false, message: "That object is not in this world." };
      if (request.action === "climb" && target.family !== "plank" && target.family !== "beam") {
        return { ok: false, message: "Climbing needs a physical plank or beam surface." };
      }
      if (target.kind === "part" && target.team && actors.some((actor) => actor?.team !== target.team)) {
        // Opposing pieces remain physically stealable, so this is intentionally legal.
      }
      const reservedBy = this.reservations.get(request.targetId);
      if (reservedBy && !request.actorIds.includes(reservedBy) && !allowQueuedReservation) {
        return { ok: false, message: "Another worker has reserved that object." };
      }
      if (
        ["carry", "assistCarry", "stage"].includes(request.action) &&
        target.kind === "part" &&
        ((target.family === "beam" && target.variant?.startsWith("long-")) ||
          target.family === "plank") &&
        request.actorIds.length < 2
      ) {
        return { ok: false, message: "That load requires two workers." };
      }
      if (request.action === "tension" && target.family !== "rope") {
        return { ok: false, message: "Tension needs one of the visible rope pieces." };
      }
      if (request.action === "operate") {
        if (target.kind !== "queen-device" && target.kind !== "battle-machine") {
          return { ok: false, message: "Operate needs a visible battlefield machine." };
        }
        const operatingTeam = target.kind === "queen-device" ? "queen" : target.team;
        if (!operatingTeam || actors.some((actor) => actor?.team !== operatingTeam)) {
          return { ok: false, message: "Only that machine's own crew can operate it." };
        }
      }
      if (request.action === "strike") {
        if (target.kind !== "queen-device" && target.kind !== "battle-machine") {
          return { ok: false, message: "Strike needs an opposing visible machine." };
        }
        const defendingTeam = target.kind === "queen-device" ? "queen" : target.team;
        if (!defendingTeam || actors.some((actor) => actor?.team === defendingTeam)) {
          return { ok: false, message: "A crew can strike only an opposing machine." };
        }
      }
    }
    if (["carry", "stage", "push", "pull"].includes(request.action) && !request.destination) {
      return { ok: false, message: "That order needs a destination." };
    }
    if (request.action === "align" && (!request.targetId || !request.destination || !request.orientation)) {
      return { ok: false, message: "Alignment needs an object, position, and orientation." };
    }
    if (request.action === "turn" && (!request.targetId || !request.orientation)) {
      return { ok: false, message: "Turning needs an object and orientation." };
    }
    const connectionAction = request.action === "connect" ||
      request.action === "hookRope" || request.action === "reeveRope";
    if (connectionAction && (!request.targetId || !request.secondaryId)) {
      return { ok: false, message: "A connection needs two aligned pieces." };
    }
    if (connectionAction) {
      const firstId = request.targetId;
      const secondId = request.secondaryId;
      if (!firstId || !secondId) {
        return { ok: false, message: "A connection needs two aligned pieces." };
      }
      if (!request.connectionClass || !CONNECTION_CLASSES.includes(request.connectionClass)) {
        return { ok: false, message: "Choose one of the four connection classes." };
      }
      if (request.action === "connect" && request.connectionClass === "ROPE_ATTACH") {
        return { ok: false, message: "Use Hook Rope or Reeve Rope for a rope attachment." };
      }
      if (request.action !== "connect" && request.connectionClass !== "ROPE_ATTACH") {
        return { ok: false, message: "Rope work uses the ROPE_ATTACH class." };
      }
      const first = this.physics.records.get(firstId);
      const second = this.physics.records.get(secondId);
      if (!first || !second) return { ok: false, message: "One of those pieces is missing." };
      if (!connectionClassSupportsFamilies(request.connectionClass, first.family, second.family)) {
        return { ok: false, message: "Those two part families do not expose compatible ports for that class." };
      }
      const families = new Set([first.family, second.family]);
      if (request.action === "reeveRope" && !families.has("sheave")) {
        return { ok: false, message: "Reeving needs a rope and a sheave groove." };
      }
      if (request.action === "hookRope" && families.has("sheave")) {
        return { ok: false, message: "Use Reeve Rope for a sheave groove." };
      }
    }
    if (request.loadId) {
      const load = this.physics.records.get(request.loadId);
      if (!load?.dynamic || !request.loadTravel || request.loadTravel <= 0) {
        return { ok: false, message: "A measured load needs a dynamic body and positive travel." };
      }
    }
    return { ok: true };
  }

  private updateOperate(dt: number): void {
    const active = this.requireActive();
    const targetId = active.request.targetId;
    const target = targetId ? this.physics.records.get(targetId) : undefined;
    if (!targetId || !target || (target.kind !== "queen-device" && target.kind !== "battle-machine")) {
      return this.cancelActive("The battlefield machine is no longer available.");
    }
    if (active.phase === "starting") {
      active.phase = "approach";
      active.phaseElapsed = 0;
      active.workGoals = this.workGoals(targetId, active.request.actorIds);
      this.setCommandPostRoutes(active);
      this.reserveWorkPoses(active);
      for (const id of active.request.actorIds) this.setWorkerPhase(id, "routing");
    }
    if (active.phase === "approach") {
      const arrived = this.routeWorkers(active, active.workGoals ?? new Map(), 1.55, dt, .02) ||
        this.workersNearGoals(active, .9);
      if (!arrived) return this.guardTimeout(30);
      active.phase = "work";
      active.phaseElapsed = 0;
      for (const id of active.request.actorIds) this.setWorkerPhase(id, "testing");
      return;
    }
    if (active.phase === "work" && active.phaseElapsed >= .72) {
      if (target.kind === "battle-machine") {
        const result = this.physics.operateBattleMachine(targetId);
        if (!result.ok) return this.cancelActive(result.message);
        this.complete(`${this.actorNames(active.request.actorIds)} operate the ${plainObject(target)}. ${result.message}`);
        return;
      }
      const result = this.physics.fireQueenBolt();
      if (!result.ok) return this.cancelActive(result.message ?? "The command post cannot fire.");
      this.complete(`${this.actorNames(active.request.actorIds)} operate the command post and fire a crown bolt at Humpty.`);
    }
  }

  private updateStrike(dt: number): void {
    const active = this.requireActive();
    const targetId = active.request.targetId;
    const target = targetId ? this.physics.records.get(targetId) : undefined;
    if (!targetId || !target || (target.kind !== "queen-device" && target.kind !== "battle-machine")) {
      return this.cancelActive("The opposing machine is no longer available.");
    }
    if (active.phase === "starting") {
      active.phase = "approach";
      active.phaseElapsed = 0;
      active.workGoals = this.workGoals(targetId, active.request.actorIds);
      this.setCommandPostRoutes(active);
      this.reserveWorkPoses(active);
      for (const id of active.request.actorIds) this.setWorkerPhase(id, "routing");
    }
    if (active.phase === "approach") {
      const arrived = this.routeWorkers(active, active.workGoals ?? new Map(), 1.45, dt, .02) ||
        this.workersNearGoals(active, .9);
      if (!arrived) return this.guardTimeout(30);
      active.phase = "work";
      active.phaseElapsed = 0;
      for (const id of active.request.actorIds) this.setWorkerPhase(id, "pushing");
      return;
    }
    if (active.phase === "work" && active.phaseElapsed >= .52) {
      const result = target.kind === "battle-machine"
        ? this.physics.strikeBattleMachine(targetId, active.request.actorIds)
        : this.physics.strikeQueenDevice(active.request.actorIds);
      if (!result.ok) return this.cancelActive(result.message ?? "The striking crew cannot reach the command post.");
      const status = result.integrity && result.integrity > 0
        ? ` The machine falls to ${Math.round(result.integrity)}% integrity.`
        : " The machine is disabled.";
      this.complete(`${this.actorNames(active.request.actorIds)} strike the ${plainObject(target)}.${status}`);
    }
  }

  private startNext(): void {
    const request = this.queue.shift();
    if (!request) return;
    this.active = {
      request,
      phase: "starting",
      phaseElapsed: 0,
      totalElapsed: 0,
      routes: new Map(),
      initialTargetPosition: undefined,
      initialTargetRotation: undefined,
      initialSecondaryPosition: undefined,
      initialSecondaryRotation: undefined,
      initialLoadPosition: undefined,
      workGoals: undefined,
      transitGoals: undefined,
      workVector: undefined,
      workPointLocal: undefined,
      stableSeconds: 0,
      sawSupportContact: false,
      sawLoadContact: false,
      formationFollow: false,
      formationOffsets: undefined,
      fulcrumBodyId: undefined,
      fulcrumPointLocal: undefined,
      fulcrumRelativeOffset: undefined,
      inProgressConnectionId: undefined,
      initialRopeLengths: undefined,
      lastRopeLengthUpdate: -1,
    };
    for (const actorId of request.actorIds) {
      const worker = this.workers.get(actorId);
      if (!worker) continue;
      worker.action = request.action;
      worker.targetId = request.targetId;
      worker.destination = request.destination ? { ...request.destination } : undefined;
      worker.phase = request.action === "reserve" ? "reaching" : "routing";
    }
    this.emitStart(request);
  }

  private updateReserve(): void {
    const active = this.requireActive();
    if (active.phaseElapsed < 0.32) return;
    const targetId = active.request.targetId;
    const actorId = active.request.actorIds[0];
    if (targetId && actorId) this.reservations.set(targetId, actorId);
    this.complete("The piece is reserved.");
  }

  private updateFetch(dt: number): void {
    const active = this.requireActive();
    const targetId = active.request.targetId;
    if (!targetId) return this.cancelActive("Fetch needs an object.");
    const target = this.physics.records.get(targetId);
    if (!target) return this.cancelActive("The object is gone.");
    if (active.phase === "starting") {
      active.phase = "approach";
      active.phaseElapsed = 0;
      const targetPosition = this.physics.bodyPosition(targetId);
      active.workGoals = active.request.targetPort === "gunner-approach" && targetPosition
        ? new Map(active.request.actorIds.map((id) => [id, {
          x: targetPosition.x + .92,
          y: .775,
          z: targetPosition.z,
        }]))
        : active.request.targetPort === "hoist-hook-approach" && targetPosition
        ? new Map(active.request.actorIds.map((id) => [id, {
          x: targetPosition.x - .95,
          y: .775,
          z: targetPosition.z - .32,
        }]))
        : active.request.targetPort === "hoist-brace-approach" && targetPosition
          ? new Map(active.request.actorIds.map((id) => [id, {
            x: targetPosition.x,
            y: .775,
            z: targetPosition.z - .75,
          }]))
          : this.workGoals(targetId, active.request.actorIds);
      if (
        active.request.targetPort === "hoist-hook-approach" ||
        active.request.targetPort === "hoist-brace-approach"
      ) {
        for (const [id, goal] of active.workGoals) active.routes.set(id, [goal]);
      }
      this.reserveWorkPoses(active);
    }
    if (active.phase === "approach") {
      const arrived = this.routeWorkers(active, active.workGoals ?? new Map(), 1.65, dt, 0);
      if (!arrived) return this.guardTimeout(28);
      active.phase = "grasp";
      active.phaseElapsed = 0;
      for (const id of active.request.actorIds) this.setWorkerPhase(id, "reaching");
      return;
    }
    if (active.phase === "grasp" && active.phaseElapsed >= 0.6) {
      this.complete(`${this.actorNames(active.request.actorIds)} ${active.request.actorIds.length > 1 ? "reach" : "reaches"} the ${plainObject(target)}.`);
    }
  }

  private updateClimb(dt: number): void {
    const active = this.requireActive();
    const targetId = active.request.targetId;
    const workerId = active.request.actorIds[0];
    if (!targetId || !workerId) return this.cancelActive("Climb needs one worker and a surface.");
    if (active.request.actorIds.length !== 1) {
      return this.cancelActive("Figures climb one at a time so the surface remains collision-authoritative.");
    }
    const target = this.physics.records.get(targetId);
    const targetPosition = this.physics.bodyPosition(targetId);
    const targetRotation = this.physics.bodyRotation(targetId);
    const workerPosition = this.physics.bodyPosition(workerId);
    if (!target || !targetPosition || !targetRotation || !workerPosition) {
      return this.cancelActive("The climbing surface is no longer available.");
    }
    const localAxis = target.size.z >= target.size.x
      ? { x: 0, y: 0, z: 1 }
      : { x: 1, y: 0, z: 0 };
    const axis = normalize(rotateVector(localAxis, targetRotation));
    const halfLength = Math.max(target.size.x, target.size.z) * .45;
    const firstEnd = add(targetPosition, scaleVector(axis, halfLength));
    const secondEnd = add(targetPosition, scaleVector(axis, -halfLength));
    const lowEnd = firstEnd.y <= secondEnd.y ? firstEnd : secondEnd;
    const highEnd = firstEnd.y <= secondEnd.y ? secondEnd : firstEnd;
    const climbDirection = normalize({
      x: highEnd.x - lowEnd.x,
      y: 0,
      z: highEnd.z - lowEnd.z,
    });
    if (active.phase === "starting") {
      if (highEnd.y - lowEnd.y < .08) {
        return this.cancelActive("The surface is too level to provide a climb.");
      }
      active.initialTargetPosition = { ...workerPosition };
      active.initialSecondaryPosition = { ...lowEnd };
      active.initialLoadPosition = { ...highEnd };
      active.workVector = climbDirection;
      const approach = {
        x: lowEnd.x - climbDirection.x * .42,
        y: .775,
        z: lowEnd.z - climbDirection.z * .42,
      };
      active.workGoals = new Map([[workerId, approach]]);
      const sideDirection = targetPosition.z >= 0 ? 1 : -1;
      const sideZ = targetPosition.z + sideDirection * 3;
      active.routes.set(workerId, [
        { x: workerPosition.x, y: .775, z: sideZ },
        { x: approach.x, y: .775, z: sideZ },
        approach,
      ]);
      active.phase = "approach";
      active.phaseElapsed = 0;
      this.reserveWorkPoses(active);
      this.setWorkerPhase(workerId, "routing");
    }
    if (active.phase === "approach") {
      const arrived = this.routeWorkers(active, active.workGoals ?? new Map(), 1.4, dt, 0, false, .2);
      if (!arrived) return this.guardTimeout(30);
      active.phase = "work";
      active.phaseElapsed = 0;
      active.routes.clear();
      this.setWorkerPhase(workerId, "climbing");
      return;
    }
    if (active.phase !== "work") return;
    const liveWorker = this.physics.bodyPosition(workerId);
    if (!liveWorker) return this.cancelActive("The climber loses the route.");
    const horizontalRemaining = Math.hypot(highEnd.x - liveWorker.x, highEnd.z - liveWorker.z);
    const start = active.initialTargetPosition ?? liveWorker;
    const rise = liveWorker.y - start.y;
    const low = active.initialSecondaryPosition ?? lowEnd;
    const high = active.initialLoadPosition ?? highEnd;
    const totalRun = Math.max(.01, Math.hypot(high.x - low.x, high.z - low.z));
    const progress = (
      (liveWorker.x - low.x) * climbDirection.x +
      (liveWorker.z - low.z) * climbDirection.z
    ) / totalRun;
    if ((horizontalRemaining < .28 || progress >= .72) && rise >= .11) {
      this.complete(`${this.actorNames(active.request.actorIds)} climb the inclined surface and gain ${rise.toFixed(2)} metres.`);
      return;
    }
    const step = Math.min(horizontalRemaining, .92 * dt);
    const slopeRise = Math.max(0, highEnd.y - lowEnd.y) / totalRun * step;
    const mountHeight = lowEnd.y + .68;
    const mounting = progress < .16 && liveWorker.y < mountHeight;
    const mountingLift = mounting ? Math.min(mountHeight - liveWorker.y, .48 * dt) : 0;
    const result = this.physics.moveCharacter(
      workerId,
      {
        x: climbDirection.x * step,
        y: mounting ? mountingLift : slopeRise,
        z: climbDirection.z * step,
      },
      climbDirection,
      mounting,
    );
    if (result && Math.hypot(result.moved.x, result.moved.z) > .0001) {
      const worker = this.workers.get(workerId);
      if (worker) worker.facing = climbDirection;
    }
    if (active.phaseElapsed > 12) {
      this.cancelActive("The climber cannot gain stable purchase on the surface.");
    }
  }

  private updateCarry(dt: number): void {
    const active = this.requireActive();
    const targetId = active.request.targetId;
    let destination = active.request.destination;
    if (!targetId || !destination) return this.cancelActive("Carry needs a load and destination.");
    const target = this.physics.records.get(targetId);
    if (!target || target.kind !== "part") return this.cancelActive("Only a loose machine piece can be carried here.");
    if (
      (active.request.secondaryPort === "plank-ram-high" ||
        active.request.secondaryPort === "plank-ram-overhead") &&
      active.request.secondaryId
    ) {
      const plank = this.physics.records.get(active.request.secondaryId);
      const plankPosition = this.physics.bodyPosition(active.request.secondaryId);
      const plankRotation = this.physics.bodyRotation(active.request.secondaryId);
      if (!plank || plank.family !== "plank" || !plankPosition || !plankRotation) {
        return this.cancelActive("The moving chassis yoke is no longer available.");
      }
      const plankForward = normalize(rotateVector({ x: 0, y: 0, z: 1 }, plankRotation));
      const plankUp = normalize(rotateVector({ x: 0, y: 1, z: 0 }, plankRotation));
      destination = add(
        plankPosition,
        add(
          scaleVector(plankForward, RAM_SADDLE_FORWARD),
          scaleVector(
            plankUp,
            RAM_SADDLE_HEIGHT +
              (active.request.secondaryPort === "plank-ram-overhead" ? .75 : .26),
          ),
        ),
      );
    }
    if (active.phase === "starting") {
      active.initialTargetPosition = this.physics.bodyPosition(targetId);
      active.workGoals = this.workGoals(targetId, active.request.actorIds);
      const inheritsAlignmentHold = active.request.actorIds.every((id) => target.carriedBy?.includes(id));
      if (
        active.request.targetPort === "resume-grip" ||
        isRamOpenSide(active.request.targetPort) ||
        active.request.targetPort?.startsWith("lever-") ||
        inheritsAlignmentHold
      ) {
        const partPosition = this.physics.bodyPosition(targetId);
        const handlingRadius = Math.max(target.size.x, target.size.z) / 2 + .95;
        const workersNear = partPosition && active.request.actorIds.every((id) => {
          const workerPosition = this.physics.bodyPosition(id);
          return workerPosition
            ? horizontalDistance(workerPosition, partPosition) < handlingRadius
            : false;
        });
        if (workersNear) {
          active.formationOffsets = partPosition
            ? new Map(active.request.actorIds.map((id) => {
              const workerPosition = this.physics.bodyPosition(id) ?? partPosition;
              return [id, subtract(workerPosition, partPosition)];
            }))
            : undefined;
          const group = this.attachCarry(targetId, active.request.actorIds, true);
          if (!group) return this.cancelActive("The workers cannot transfer that grip.");
          if (active.request.targetPort?.startsWith("lever-") && group.actorIds.length === 2) {
            group.joints = group.actorIds.map((actorId, index) => ({
              actorId,
              partAnchor: { x: 0, y: 0, z: index === 0 ? -.72 : .72 },
              handOffsetLocal: { x: .58, y: 0, z: 0 },
              overstretchSeconds: 0,
            }));
          }
          if (active.request.targetPort === "hold-behind" && group.actorIds.length === 1) {
            group.gripTargetAngle = Math.PI / 2;
          }
          if (active.request.targetPort === "hold-front" && group.actorIds.length === 1) {
            group.gripTargetAngle = -Math.PI / 2;
          }
          if (active.request.targetPort === "hold-opposite" && group.actorIds.length === 1) {
            group.gripTargetAngle = Math.PI;
          }
          if (isRamOpenSide(active.request.targetPort)) {
            this.extendRamCarryReach(targetId, group);
          }
          group.releaseHeight = destination.y;
          this.carrying.set(targetId, group);
          this.physics.setCarried(targetId, active.request.actorIds);
          this.setConnectedWheelsetCarried(targetId, active.request.actorIds);
          active.phase = "lift";
          active.phaseElapsed = 0;
          for (const id of active.request.actorIds) this.setWorkerPhase(id, "carrying");
          this.emit({
            text: `${this.actorNames(active.request.actorIds)} keep their balanced grips for the carry.`,
            actorId: active.request.actorIds[0],
            team: this.workers.get(active.request.actorIds[0] ?? "")?.team,
          });
          return;
        }
      }
      active.phase = "approach";
      active.phaseElapsed = 0;
      this.reserveWorkPoses(active);
    }
    if (active.phase === "approach") {
      const arrived = this.routeWorkers(active, active.workGoals ?? new Map(), 1.55, dt, 0);
      if (!arrived) return this.guardTimeout(30);
      active.phase = "grasp";
      active.phaseElapsed = 0;
      for (const id of active.request.actorIds) this.setWorkerPhase(id, "grasping");
      return;
    }
    if (active.phase === "grasp") {
      if (active.phaseElapsed < 0.65) return;
      if (!this.carrying.has(targetId)) {
        const group = this.attachCarry(targetId, active.request.actorIds);
        if (!group) return this.cancelActive("The workers cannot secure that load from here.");
        if (active.request.targetPort === "hold-behind" && group.actorIds.length === 1) {
          group.gripTargetAngle = Math.PI / 2;
        }
        if (active.request.targetPort === "hold-front" && group.actorIds.length === 1) {
          group.gripTargetAngle = -Math.PI / 2;
        }
        if (active.request.targetPort === "hold-opposite" && group.actorIds.length === 1) {
          group.gripTargetAngle = Math.PI;
        }
        if (isRamOpenSide(active.request.targetPort)) {
          this.extendRamCarryReach(targetId, group);
        }
        group.releaseHeight = destination.y;
        this.carrying.set(targetId, group);
        this.physics.setCarried(targetId, active.request.actorIds);
        this.setConnectedWheelsetCarried(targetId, active.request.actorIds);
        this.emit({
          text: `${this.actorNames(active.request.actorIds)} ${active.request.actorIds.length > 1 ? "lift" : "lifts"} the ${plainObject(target)} together.`,
          actorId: active.request.actorIds[0],
          team: this.workers.get(active.request.actorIds[0] ?? "")?.team,
          technical: `carry constraints ${group.joints.length}`,
        });
      }
      active.phase = "lift";
      active.phaseElapsed = 0;
      for (const id of active.request.actorIds) this.setWorkerPhase(id, "carrying");
      return;
    }
    if (active.phase === "lift") {
      if (active.phaseElapsed < 1.1) return;
      active.phase = "transit";
      active.phaseElapsed = 0;
      active.transitGoals = this.carryDestinationGoals(
        destination,
        active.request.actorIds,
        targetId,
        active.request.orientation,
      );
      if (isRamOpenSide(active.request.targetPort)) {
        const openSide = destination.x < 0 ? -1 : 1;
        active.transitGoals = new Map(active.request.actorIds.map((id, index) => [id, {
          x: destination.x + openSide * 1.55,
          y: .775,
          z: destination.z + (index === 0 ? -1.05 : 1.05),
        }]));
      }
      active.routes.clear();
      if (active.request.actorIds.length > 1) {
        const partPosition = this.physics.bodyPosition(targetId) ?? destination;
        const centerRoute = active.request.targetPort === "lever-final-approach"
          ? [{ ...destination, y: .775 }]
          : active.request.secondaryPort === "plank-ram-overhead"
            ? (() => {
              const openSide = destination.x < 0 ? -1 : 1;
              return [
                {
                  x: openSide * Math.max(4.4, Math.abs(partPosition.x)),
                  y: .775,
                  z: destination.z,
                },
                { ...destination, y: .775 },
              ];
            })()
          : this.buildRoute(partPosition, destination, this.carryRadius(target));
        for (const id of active.request.actorIds) {
          const goal = active.transitGoals.get(id);
          if (!goal) continue;
          const offset = subtract(goal, destination);
          active.routes.set(id, centerRoute.map((waypoint) => ({
            x: waypoint.x + offset.x,
            y: .775,
            z: waypoint.z + offset.z,
          })));
        }
      }
      return;
    }
    if (active.phase === "transit") {
      const arrived = this.routeWorkers(
        active,
        active.transitGoals ?? new Map(),
        0.95,
        dt,
        this.carryRadius(target),
        false,
        isRamOpenSide(active.request.targetPort) ? 1.25 : .07,
      );
      const partPosition = this.physics.bodyPosition(targetId);
      const handlersRemainNear = partPosition && active.request.actorIds.every((id) => {
        const workerPosition = this.physics.bodyPosition(id);
        const handlingRadius = Math.max(target.size.x, target.size.z) / 2 +
          (isRamOpenSide(active.request.targetPort) ? 2 : .85);
        return workerPosition
          ? horizontalDistance(workerPosition, partPosition) < handlingRadius
          : false;
      });
      const supportedRamCarry = isRamOpenSide(active.request.targetPort);
      const supportedRamFormation = supportedRamCarry && handlersRemainNear;
      if ((arrived || supportedRamCarry) && partPosition && active.request.actorIds.length > 1) {
        const velocity = this.physics.bodyLinearVelocity(targetId) ?? { x: 0, y: 0, z: 0 };
        const positionGain = supportedRamCarry ? 1_400 : 480;
        const damping = supportedRamCarry ? 220 : 140;
        const centeringForce = clampVector({
          x: (destination.x - partPosition.x) * positionGain - velocity.x * damping,
          y: (destination.y - partPosition.y) * positionGain - velocity.y * damping,
          z: (destination.z - partPosition.z) * positionGain - velocity.z * damping,
        }, (supportedRamCarry ? 2_600 : 360) * active.request.actorIds.length);
        this.physics.applyImpulse(targetId, scaleVector(centeringForce, dt));
      }
      const precisionWheelsetMove = target.family === "axle" &&
        this.connections.filter((connection) =>
          connection.class === "KEYED_COAXIAL" &&
          (connection.bodyA === targetId || connection.bodyB === targetId)
        ).length >= 2;
      const destinationTolerance = precisionWheelsetMove
        ? .12
        : active.request.actorIds.length === 1 ? 0.18 : 0.34;
      const partNear = partPosition
        ? horizontalDistance(partPosition, destination) < destinationTolerance
        : false;
      const validAlternateFormation = active.request.actorIds.length > 1 && handlersRemainNear;
      if ((!arrived && !validAlternateFormation) || !partNear) return this.guardTimeout(42);
      this.complete(`${this.actorNames(active.request.actorIds)} carry the ${plainObject(target)} into the open work bay.`, false);
    }
  }

  private updateRelease(dt: number): void {
    const active = this.requireActive();
    const targetId = active.request.targetId;
    if (!targetId) return this.cancelActive("Release needs a carried object.");
    if (active.phase === "starting") {
      const group = this.carrying.get(targetId);
      if (!group) {
        this.physics.clearCarried(targetId);
        this.beginReleaseClear(active, targetId);
        this.emit({ text: `${this.actorNames(active.request.actorIds)} release their alignment hold and step clear.` });
        return;
      }
      const part = this.physics.records.get(targetId);
      group.releaseHeight = active.request.destination?.y ?? Math.max(.08, (part?.size.y ?? .16) / 2 + .02);
      active.phase = "work";
      active.phaseElapsed = 0;
      for (const id of active.request.actorIds) this.setWorkerPhase(id, "staging");
      this.emit({ text: `${this.actorNames(active.request.actorIds)} lower the load onto its support.` });
      return;
    }
    if (active.phase === "work") {
      const group = this.carrying.get(targetId);
      const position = this.physics.bodyPosition(targetId);
      const velocity = this.physics.bodyLinearVelocity(targetId);
      if (!group || !position || !velocity) return this.cancelActive("The workers lose the load while lowering it.");
      const atHeight = Math.abs(position.y - (group.releaseHeight ?? position.y)) < .045;
      const slow = Math.abs(velocity.y) < .16;
      if ((!atHeight || !slow) && active.phaseElapsed < 3.2) return;
      this.carrying.delete(targetId);
      this.physics.clearCarried(targetId);
      if (active.request.targetPort === "stable-staging") this.physics.settleBody(targetId);
      const next = this.queue[0];
      if (
        next?.targetId === targetId &&
        (next.action === "push" || next.action === "pull") &&
        active.request.actorIds.every((id) => next.actorIds.includes(id))
      ) {
        this.complete(`${this.actorNames(active.request.actorIds)} shift directly from the brace to the push.`);
        return;
      }
      this.beginReleaseClear(active, targetId);
      this.emit({
        text: `${this.actorNames(active.request.actorIds)} release the supported load and step clear.`,
        technical: `release:${targetId}`,
      });
      return;
    }
    if (active.phase === "clear") {
      const clear = this.routeWorkers(active, active.workGoals ?? new Map(), 1.25, dt, 0);
      if (clear) {
        this.physics.clearCarried(targetId);
        this.complete("The work pose is clear.");
      } else if (active.totalElapsed > 8) {
        this.physics.clearCarried(targetId);
        this.guardTimeout(8);
      }
    }
  }

  private updatePush(dt: number): void {
    const active = this.requireActive();
    const targetId = active.request.targetId;
    const destination = active.request.destination;
    if (!targetId || !destination) return this.cancelActive("Push needs an object and direction.");
    const targetPosition = this.physics.bodyPosition(targetId);
    if (!targetPosition) return this.cancelActive("The target is gone.");
    if (active.phase === "starting") {
      active.initialTargetPosition = { ...targetPosition };
      const target = this.physics.records.get(targetId);
      const targetRotation = this.physics.bodyRotation(targetId) ?? { x: 0, y: 0, z: 0, w: 1 };
      active.initialTargetRotation = { ...(active.request.orientation ?? targetRotation) };
      active.initialSecondaryPosition = active.request.secondaryId
        ? this.physics.bodyPosition(active.request.secondaryId)
        : undefined;
      active.initialSecondaryRotation = active.request.secondaryId
        ? active.request.orientation ?? this.physics.bodyRotation(active.request.secondaryId)
        : undefined;
      active.initialLoadPosition = active.request.loadId
        ? this.physics.bodyPosition(active.request.loadId)
        : undefined;
      if (active.request.secondaryPort === "supported-horizontal" && target) {
        const fulcrum = [...this.physics.records.values()].find(
          (record) =>
            record.kind === "part" &&
            (record.family === "wedge" || record.family === "hub") &&
            this.physics.contactCount(targetId, record.id) > 0,
        );
        const fulcrumPosition = fulcrum
          ? this.physics.bodyPosition(fulcrum.id)
          : undefined;
        if (fulcrum && fulcrumPosition) {
          const axis = normalize(rotateVector({ x: 0, y: 0, z: 1 }, targetRotation));
          const projected = Math.max(
            -target.size.z * .46,
            Math.min(target.size.z * .46, dot(subtract(fulcrumPosition, targetPosition), axis)),
          );
          const point = add(targetPosition, scaleVector(axis, projected));
          active.fulcrumBodyId = fulcrum.id;
          active.fulcrumPointLocal = { x: 0, y: 0, z: projected };
          active.fulcrumRelativeOffset = subtract(point, fulcrumPosition);
        }
      }
      active.workPointLocal = target && active.request.targetPort?.startsWith("end-")
        ? partEndLocal(target.size, active.request.targetPort === "end-positive" ? 1 : -1)
        : { x: 0, y: 0, z: 0 };
      const point = add(targetPosition, rotateVector(active.workPointLocal, targetRotation));
      const delta = subtract(destination, point);
      const length = Math.max(0.01, vectorLength(delta));
      const direction = scaleVector(delta, 1 / length);
      active.workVector = direction;
      const horizontalLength = Math.hypot(direction.x, direction.z);
      const stand = horizontalLength > .25
        ? { x: -direction.x / horizontalLength, z: -direction.z / horizontalLength }
        : { x: this.workers.get(active.request.actorIds[0] ?? "")?.team === "king" ? -1 : 1, z: 0 };
      const firstStandDistance = active.request.targetPort === "projectile-launch" ? .82 : .52;
      active.workGoals = new Map(active.request.actorIds.map((id, index) => [id, {
        x: point.x + stand.x * (firstStandDistance + index * 0.38) + stand.z * (index - (active.request.actorIds.length - 1) / 2) * .32,
        y: 0.775,
        z: point.z + stand.z * (firstStandDistance + index * 0.38) - stand.x * (index - (active.request.actorIds.length - 1) / 2) * .32,
      }]));
      if (active.request.targetPort === "assembly-push") {
        const backgroundBrace = this.carrying.get(targetId);
        if (backgroundBrace) {
          this.carrying.delete(targetId);
          this.physics.clearCarried(targetId);
          this.emit({
            text: `${this.actorNames(backgroundBrace.actorIds)} release the chassis brace and circle into the crew formation.`,
            actorId: backgroundBrace.actorIds[0],
            team: this.workers.get(backgroundBrace.actorIds[0] ?? "")?.team,
          });
        }
        const rearExtent = target
          ? projectedHalfExtent(target.size, targetRotation, "x")
          : .8;
        const strokeSign = Math.sign(active.workVector?.x ?? 1) || 1;
        active.workGoals = new Map(active.request.actorIds.map((id, index) => {
          const lateral = (index - (active.request.actorIds.length - 1) / 2) * 1.12;
          const goal = {
            x: targetPosition.x - strokeSign * (rearExtent + .62),
            y: .775,
            z: targetPosition.z + lateral,
          };
          const current = this.physics.bodyPosition(id) ?? goal;
          const safeX = targetPosition.x - strokeSign * (rearExtent + 1.3);
          const frontEdge = targetPosition.x + strokeSign * rearExtent;
          const behindCart = (targetPosition.x - current.x) * strokeSign > rearExtent + .15;
          const onStrokeSide = (current.x - frontEdge) * strokeSign > .15;
          const detourSign = current.z >= targetPosition.z ? 1 : -1;
          const detourZ = targetPosition.z + detourSign * 2.55;
          const frontClearX = frontEdge + strokeSign * .72;
          const route: Vec3[] = [];
          if (onStrokeSide) {
            route.push(
              { x: frontClearX, y: .775, z: current.z },
              { x: frontClearX, y: .775, z: detourZ },
              { x: safeX, y: .775, z: detourZ },
            );
          } else if (!behindCart) {
            route.push(
              { x: current.x, y: .775, z: detourZ },
              { x: safeX, y: .775, z: detourZ },
            );
          } else {
            route.push({ x: safeX, y: .775, z: current.z });
          }
          route.push(
            { x: safeX, y: .775, z: targetPosition.z + lateral },
            goal,
          );
          active.routes.set(id, route);
          return [id, goal];
        }));
      }
      const supportedGrip =
        active.request.targetPort === "supported-center" ||
        active.request.secondaryPort === "supported" ||
        active.request.secondaryPort === "supported-horizontal";
      if (supportedGrip) {
        if (this.carrying.has(targetId)) {
          this.carrying.delete(targetId);
          this.physics.clearCarried(targetId);
          this.emit({
            text: `${this.actorNames(active.request.actorIds)} shift from carrying grips into a moving brace.`,
            actorId: active.request.actorIds[0],
            team: this.workers.get(active.request.actorIds[0] ?? "")?.team,
          });
        }
        active.formationOffsets = new Map(active.request.actorIds.map((id) => {
          const workerPosition = this.physics.bodyPosition(id) ?? targetPosition;
          return [id, subtract(workerPosition, targetPosition)];
        }));
        active.workGoals = new Map(active.request.actorIds.map((id) => [
          id,
          this.physics.bodyPosition(id) ?? targetPosition,
        ]));
      }
      active.phase = supportedGrip ? "work" : "approach";
      active.phaseElapsed = 0;
      this.reserveWorkPoses(active);
      if (supportedGrip) {
        for (const id of active.request.actorIds) this.setWorkerPhase(id, "pushing");
      }
    }
    if (active.phase === "approach") {
      if (
        active.request.targetPort === "assembly-push" &&
        active.request.secondaryPort === "worker-supported"
      ) {
        this.supportAssemblySecondary(active, dt);
      }
      const target = this.physics.records.get(targetId);
      if (
        target?.kind === "part" &&
        active.request.actorIds.length > 1 &&
        active.initialTargetPosition &&
        active.initialTargetRotation
      ) {
        const position = this.physics.bodyPosition(targetId);
        const rotation = this.physics.bodyRotation(targetId);
        const velocity = this.physics.bodyLinearVelocity(targetId);
        const angularVelocity = this.physics.bodyAngularVelocity(targetId);
        if (!position || !rotation || !velocity || !angularVelocity) {
          return this.cancelActive("The workers lose the supported push pose.");
        }
        const positionError = subtract(active.initialTargetPosition, position);
        const supportForce = clampVector({
          x: positionError.x * 320 - velocity.x * 300,
          y: positionError.y * 320 - velocity.y * 80 + 9.81 * approximateMass(target),
          z: positionError.z * 320 - velocity.z * 300,
        }, 420 * active.request.actorIds.length);
        this.physics.applyImpulse(targetId, scaleVector(supportForce, dt));
        const angularError = quaternionAngularError(active.initialTargetRotation, rotation);
        const supportTorque = inertialTorque(target, rotation, {
          x: angularError.x * 22 - angularVelocity.x * 10,
          y: angularError.y * 22 - angularVelocity.y * 10,
          z: angularError.z * 22 - angularVelocity.z * 10,
        });
        this.physics.applyTorqueImpulse(
          targetId,
          scaleVector(clampVector(supportTorque, 180), dt),
        );
      }
      let arrived = this.routeWorkers(active, active.workGoals ?? new Map(), 1.5, dt, 0);
      if (!arrived && active.phaseElapsed > 1.5 && active.request.actorIds.length > 1) {
        const position = this.physics.bodyPosition(targetId);
        const direction = active.workVector;
        const target = this.physics.records.get(targetId);
        const handlingRadius = target
          ? Math.max(target.size.x, target.size.z) / 2 + 1.05
          : 1.5;
        const workersBraceBehind = position && direction && active.request.actorIds.every((id) => {
          const workerPosition = this.physics.bodyPosition(id);
          if (!workerPosition) return false;
          const fromLoad = subtract(workerPosition, position);
          const directionalSide = dot(fromLoad, direction);
          return (
            horizontalDistance(workerPosition, position) < handlingRadius &&
            (active.request.action === "pull"
              ? directionalSide > .15
              : directionalSide < .15)
          );
        });
        arrived = Boolean(workersBraceBehind);
      }
      if (!arrived) return this.guardTimeout(24);
      const backgroundBrace = active.request.targetPort === "assembly-push"
        ? this.carrying.get(targetId)
        : undefined;
      if (backgroundBrace) {
        this.carrying.delete(targetId);
        this.physics.clearCarried(targetId);
        this.emit({
          text: `${this.actorNames(backgroundBrace.actorIds)} release the chassis brace as the pushers set their shoulders.`,
          actorId: backgroundBrace.actorIds[0],
          team: this.workers.get(backgroundBrace.actorIds[0] ?? "")?.team,
        });
      }
      active.phase = "work";
      active.phaseElapsed = 0;
      active.routes.clear();
      for (const id of active.request.actorIds) {
        this.physics.setCharacterPushesBodies(
          id,
          active.request.targetPort !== "assembly-push",
        );
        this.setWorkerPhase(id, active.request.action === "pull" ? "pulling" : "pushing");
      }
      return;
    }
    if (active.phase === "work") {
      let vector = active.workVector ?? { x: 1, y: 0, z: 0 };
      if (
        (active.request.targetPort === "supported-center" ||
          active.request.secondaryPort === "supported" ||
          active.request.secondaryPort === "supported-horizontal") &&
        active.formationOffsets
      ) {
        const livePosition = this.physics.bodyPosition(targetId);
        if (livePosition) {
          const followGoals = new Map(active.request.actorIds.map((id) => [
            id,
            add(livePosition, active.formationOffsets?.get(id) ?? { x: 0, y: 0, z: 0 }),
          ]));
          this.routeWorkers(active, followGoals, 1.25, dt, 0, true, .06);
        }
      }
      if (active.request.targetPort === "supported-center") {
        const fulcrumContact = active.request.secondaryId
          ? this.physics.contactCount(targetId, active.request.secondaryId) > 0
          : false;
        const declaredTower = active.request.secondaryPort
          ? this.physics.records.get(active.request.secondaryPort)
          : undefined;
        const towerContact = declaredTower?.kind === "tower-block"
          ? this.physics.contactCount(targetId, declaredTower.id) > 0
          : [...this.physics.records.values()].some(
            (record) =>
              record.kind === "tower-block" &&
              this.physics.contactCount(targetId, record.id) > 0,
          );
        if (fulcrumContact) active.sawSupportContact = true;
        if (towerContact) active.sawLoadContact = true;
        if (fulcrumContact && towerContact) {
          return this.complete(
            `${this.actorNames(active.request.actorIds)} seat the lever against its fulcrum and timber.`,
          );
        }
        const target = this.physics.records.get(targetId);
        const position = this.physics.bodyPosition(targetId);
        const rotation = this.physics.bodyRotation(targetId);
        const velocity = this.physics.bodyLinearVelocity(targetId);
        const angularVelocity = this.physics.bodyAngularVelocity(targetId);
        if (
          !target || !position || !rotation || !velocity || !angularVelocity ||
          !active.initialTargetPosition || !active.initialTargetRotation
        ) {
          return this.cancelActive("The workers lose the supported insertion.");
        }
        const verticalForce = Math.max(
          -420 * active.request.actorIds.length,
          Math.min(
            420 * active.request.actorIds.length,
            (destination.y - position.y) * 360 - velocity.y * 90 +
              9.81 * approximateMass(target),
          ),
        );
        this.physics.applyImpulse(targetId, { x: 0, y: verticalForce * dt, z: 0 });
        const angularError = quaternionAngularError(active.initialTargetRotation, rotation);
        const supportTorque = inertialTorque(target, rotation, {
          x: angularError.x * 12 - angularVelocity.x * 6,
          y: angularError.y * 12 - angularVelocity.y * 6,
          z: angularError.z * 12 - angularVelocity.z * 6,
        });
        this.physics.applyTorqueImpulse(
          targetId,
          scaleVector(clampVector(supportTorque, 90 * active.request.actorIds.length), dt),
        );
        const horizontalForce = clampVector({
          x: (destination.x - position.x) * 900 - velocity.x * 220,
          y: 0,
          z: (destination.z - position.z) * 900 - velocity.z * 220,
        }, Math.max(80, Math.min(420 * active.request.actorIds.length, active.request.magnitude ?? 220)));
        this.physics.applyImpulseAtPoint(targetId, scaleVector(horizontalForce, dt), position);
        if (active.phaseElapsed > 7) {
          return this.cancelActive("The lever will not seat against both declared contacts.");
        }
        return;
      }
      if (active.request.targetPort?.startsWith("end-")) {
        if (
          active.request.secondaryPort === "supported" ||
          active.request.secondaryPort === "supported-horizontal"
        ) {
          const supportedTarget = this.physics.records.get(targetId);
          const supportedPosition = this.physics.bodyPosition(targetId);
          const supportedRotation = this.physics.bodyRotation(targetId);
          const supportedVelocity = this.physics.bodyLinearVelocity(targetId);
          const supportedAngularVelocity = this.physics.bodyAngularVelocity(targetId);
          if (
            !supportedTarget || !supportedPosition || !supportedRotation ||
            !supportedVelocity || !supportedAngularVelocity ||
            !active.initialTargetPosition || !active.initialTargetRotation
          ) {
            return this.cancelActive("The workers lose the supported lever stroke.");
          }
          const verticalForce = Math.max(
            -420 * active.request.actorIds.length,
            Math.min(
              420 * active.request.actorIds.length,
              (active.initialTargetPosition.y - supportedPosition.y) * 240 -
                supportedVelocity.y * 100 + 9.81 * approximateMass(supportedTarget),
            ),
          );
          this.physics.applyImpulse(targetId, { x: 0, y: verticalForce * dt, z: 0 });
          const supportError = quaternionAngularError(active.initialTargetRotation, supportedRotation);
          const initialBeamAxis = normalize(rotateVector(
            { x: 0, y: 0, z: 1 },
            active.initialTargetRotation,
          ));
          const pivotAxis = active.request.secondaryPort === "supported-horizontal"
            ? { x: 0, y: 1, z: 0 }
            : normalize(cross(initialBeamAxis, { x: 0, y: 1, z: 0 }));
          const restrictedError = subtract(
            supportError,
            scaleVector(pivotAxis, dot(supportError, pivotAxis)),
          );
          const restrictedVelocity = subtract(
            supportedAngularVelocity,
            scaleVector(pivotAxis, dot(supportedAngularVelocity, pivotAxis)),
          );
          const horizontalLever = active.request.secondaryPort === "supported-horizontal";
          const supportTorque = inertialTorque(supportedTarget, supportedRotation, {
            x: restrictedError.x * (horizontalLever ? 100 : 12) -
              restrictedVelocity.x * (horizontalLever ? 35 : 6),
            y: restrictedError.y * (horizontalLever ? 100 : 12) -
              restrictedVelocity.y * (horizontalLever ? 35 : 6),
            z: restrictedError.z * (horizontalLever ? 100 : 12) -
              restrictedVelocity.z * (horizontalLever ? 35 : 6),
          });
          this.physics.applyTorqueImpulse(
            targetId,
            scaleVector(clampVector(
              supportTorque,
              horizontalLever ? 900 : 90 * active.request.actorIds.length,
            ), dt),
          );
          if (
            active.request.secondaryPort === "supported-horizontal" &&
            active.fulcrumBodyId &&
            active.fulcrumPointLocal &&
            active.fulcrumRelativeOffset
          ) {
            const fulcrumPosition = this.physics.bodyPosition(active.fulcrumBodyId);
            const fulcrumVelocity = this.physics.bodyLinearVelocity(active.fulcrumBodyId);
            if (fulcrumPosition && fulcrumVelocity) {
              const pivotOffset = rotateVector(active.fulcrumPointLocal, supportedRotation);
              const pivotPoint = add(supportedPosition, pivotOffset);
              const pivotVelocity = add(
                supportedVelocity,
                cross(supportedAngularVelocity, pivotOffset),
              );
              const desiredPivot = add(fulcrumPosition, active.fulcrumRelativeOffset);
              const braceForce = clampVector({
                x: (desiredPivot.x - pivotPoint.x) * 1_400 +
                  (fulcrumVelocity.x - pivotVelocity.x) * 180,
                y: 0,
                z: (desiredPivot.z - pivotPoint.z) * 1_400 +
                  (fulcrumVelocity.z - pivotVelocity.z) * 180,
              }, 1_200);
              const braceImpulse = scaleVector(braceForce, dt);
              this.physics.applyImpulseAtPoint(targetId, braceImpulse, pivotPoint);
              this.physics.applyImpulseAtPoint(
                active.fulcrumBodyId,
                scaleVector(braceImpulse, -1),
                fulcrumPosition,
              );
            }
          }
          const fulcrumContact = [...this.physics.records.values()].some(
            (record) =>
              record.kind === "part" &&
              (record.family === "wedge" || record.family === "hub") &&
              this.physics.contactCount(targetId, record.id) > 0,
          );
          const loadPosition = active.request.secondaryId
            ? this.physics.bodyPosition(active.request.secondaryId)
            : undefined;
          const loadContact = active.request.secondaryId
            ? this.physics.contactCount(targetId, active.request.secondaryId) > 0
            : false;
          const loadMoved = loadPosition && active.initialSecondaryPosition
            ? distance3(loadPosition, active.initialSecondaryPosition)
            : 0;
          if (loadMoved >= .35) {
            return this.completeSupportedHold(
              active,
              `${this.actorNames(active.request.actorIds)} lever the timber clear.`,
            );
          }
          if (fulcrumContact && loadContact) active.stableSeconds = 0;
          else active.stableSeconds += dt;
          if (active.phaseElapsed > .25 && active.stableSeconds > .65) {
            return this.completeSupportedHold(
              active,
              `${this.actorNames(active.request.actorIds)} stop as the lever loses contact.`,
            );
          }
        }
        const currentPosition = this.physics.bodyPosition(targetId);
        const currentRotation = this.physics.bodyRotation(targetId);
        if (!currentPosition || !currentRotation || !active.workPointLocal) {
          return this.cancelActive("The worker loses the contact point.");
        }
        const point = add(currentPosition, rotateVector(active.workPointLocal, currentRotation));
        const supportedStroke =
          active.request.secondaryPort === "supported" ||
          active.request.secondaryPort === "supported-horizontal";
        const forceCeiling = supportedStroke
          ? 4_000 * active.request.actorIds.length
          : 720 * active.request.actorIds.length;
        const beamAxis = normalize(rotateVector({ x: 0, y: 0, z: 1 }, currentRotation));
        const pivotLimitReached = active.request.secondaryPort === "supported" && beamAxis.y > .16;
        const appliedForce = Math.max(80, Math.min(forceCeiling, active.request.magnitude ?? 480));
        const controlledForce = active.request.secondaryPort === "supported-horizontal"
          ? appliedForce * Math.min(1, active.phaseElapsed / .15)
          : appliedForce;
        const effortImpulse = pivotLimitReached
          ? { x: vector.x * controlledForce * dt, y: 0, z: vector.z * controlledForce * dt }
          : scaleVector(vector, controlledForce * dt);
        this.physics.applyImpulseAtPoint(targetId, effortImpulse, point);
        if (supportedStroke) {
          // One worker presses down and inward at the effort end while the
          // second supplies an upward brace at the fulcrum. The unopposed
          // horizontal component travels through the beam into its load.
          this.physics.applyImpulseAtPoint(
            targetId,
            { x: 0, y: -effortImpulse.y, z: 0 },
            currentPosition,
          );
        }
        if (active.request.secondaryPort === "supported-horizontal") {
          const angularVelocity = this.physics.bodyAngularVelocity(targetId);
          const record = this.physics.records.get(targetId);
          if (angularVelocity && record) {
            const handDamping = inertialTorque(record, currentRotation, {
              x: 0,
              y: -angularVelocity.y * 80,
              z: 0,
            });
            this.physics.applyTorqueImpulse(
              targetId,
              scaleVector(clampVector(handDamping, 900), dt),
            );
          }
        }
        const effortDuration = active.request.secondaryPort === "supported-horizontal"
          ? 4.5
          : supportedStroke ? 2.2 : 2.8;
        if (active.phaseElapsed >= effortDuration) {
          if (supportedStroke) {
            return this.completeSupportedHold(
              active,
              `${this.actorNames(active.request.actorIds)} finish the supported lever stroke.`,
            );
          }
          return this.complete(`${this.actorNames(active.request.actorIds)} finish pressing the ${plainObject(this.physics.records.get(targetId)!)}.`);
        }
        return;
      }
      if (
        active.request.targetPort === "assembly-push" &&
        active.request.secondaryPort === "worker-supported" &&
        active.request.secondaryId &&
        active.initialSecondaryPosition &&
        active.initialSecondaryRotation
      ) {
        const supportedId = active.request.secondaryId;
        const supported = this.physics.records.get(supportedId);
        const supportedPosition = this.physics.bodyPosition(supportedId);
        const supportedRotation = this.physics.bodyRotation(supportedId);
        const supportedVelocity = this.physics.bodyLinearVelocity(supportedId);
        const supportedAngularVelocity = this.physics.bodyAngularVelocity(supportedId);
        if (supported && supportedPosition && supportedRotation && supportedVelocity && supportedAngularVelocity) {
          const verticalForce = Math.max(-1_800, Math.min(
            1_800,
            (active.initialSecondaryPosition.y - supportedPosition.y) * 1_800 -
              supportedVelocity.y * 420 + 9.81 * approximateMass(supported),
          ));
          this.physics.applyImpulse(supportedId, { x: 0, y: verticalForce * dt, z: 0 });
          const supportError = quaternionAngularError(active.initialSecondaryRotation, supportedRotation);
          const supportTorque = inertialTorque(supported, supportedRotation, {
            x: supportError.x * 180 - supportedAngularVelocity.x * 30,
            y: supportError.y * 180 - supportedAngularVelocity.y * 30,
            z: supportError.z * 180 - supportedAngularVelocity.z * 30,
          });
          this.physics.applyTorqueImpulse(
            supportedId,
            scaleVector(clampVector(supportTorque, 360), dt),
          );
        }
      }
      const contactPosition = this.physics.bodyPosition(targetId);
      if (contactPosition) {
        const targetVelocity = this.physics.bodyLinearVelocity(targetId) ?? { x: 0, y: 0, z: 0 };
        const crewSpeed = active.request.action === "pull" ? 1.2 : 1.8;
        const speedAlongStroke = dot(targetVelocity, vector);
        const crewInFormation = active.request.actorIds.every((id) => {
          const workerPosition = this.physics.bodyPosition(id);
          return workerPosition
            ? horizontalDistance(workerPosition, contactPosition) < 2.15
            : false;
        });
        const assemblyForce = crewInFormation
          ? RAM_BURST_FORCE_PER_WORKER * active.request.actorIds.length * Math.max(
            0,
            Math.min(1, (crewSpeed - speedAlongStroke) / crewSpeed),
          )
          : 0;
        const force = active.request.targetPort === "assembly-push"
          ? assemblyForce
          : active.request.targetPort === "projectile-launch"
          ? 600 * active.request.actorIds.length
          : active.request.targetPort === "supported-center"
          ? Math.max(80, Math.min(420 * active.request.actorIds.length, active.request.magnitude ?? 220))
          : 420 * active.request.actorIds.length;
        this.physics.applyImpulseAtPoint(targetId, scaleVector(vector, force * dt), contactPosition);
      }
      if (
        active.request.targetPort === "assembly-push" &&
        active.initialTargetPosition &&
        active.initialTargetRotation
      ) {
        const target = this.physics.records.get(targetId);
        const position = this.physics.bodyPosition(targetId);
        const rotation = this.physics.bodyRotation(targetId);
        const velocity = this.physics.bodyLinearVelocity(targetId);
        const angularVelocity = this.physics.bodyAngularVelocity(targetId);
        if (target && position && rotation && velocity && angularVelocity) {
          const lateralForce = Math.max(-700, Math.min(
            700,
            (active.initialTargetPosition.z - position.z) * 650 - velocity.z * 360,
          ));
          this.physics.applyImpulse(targetId, { x: 0, y: 0, z: lateralForce * dt });
          const steeringError = quaternionAngularError(active.initialTargetRotation, rotation);
          const steeringTorque = inertialTorque(target, rotation, {
            x: 0,
            y: steeringError.y * 40 - angularVelocity.y * 20,
            z: 0,
          });
          this.physics.applyTorqueImpulse(
            targetId,
            scaleVector(clampVector(steeringTorque, 300), dt),
          );
        }
      }
      const goals = new Map<string, Vec3>();
      const liveTargetPosition = this.physics.bodyPosition(targetId);
      const liveTargetRotation = this.physics.bodyRotation(targetId);
      const liveTarget = this.physics.records.get(targetId);
      for (const [index, id] of active.request.actorIds.entries()) {
        const current = this.physics.bodyPosition(id);
        if (!current) continue;
        if (
          active.request.targetPort === "assembly-push" &&
          liveTargetPosition && liveTargetRotation && liveTarget
        ) {
          const rearExtent = projectedHalfExtent(liveTarget.size, liveTargetRotation, "x");
          const strokeSign = Math.sign(active.workVector?.x ?? 1) || 1;
          goals.set(id, {
            x: liveTargetPosition.x - strokeSign * (rearExtent + .62),
            y: .775,
            z: liveTargetPosition.z +
              (index - (active.request.actorIds.length - 1) / 2) * 1.12,
          });
        } else {
          goals.set(id, {
            x: current.x + vector.x * .4,
            y: .775,
            z: current.z + vector.z * .4,
          });
        }
      }
      const workSpeed = active.request.targetPort === "assembly-push"
        ? active.request.action === "pull" ? 1.3 : 2.7
        : 1.0;
      this.routeWorkers(active, goals, workSpeed, dt, 0, true, .04);
      const currentTarget = this.physics.bodyPosition(targetId);
      const moved = currentTarget && active.initialTargetPosition
        ? horizontalDistance(currentTarget, active.initialTargetPosition)
        : 0;
      const strokeProgress = currentTarget && active.initialTargetPosition && active.workVector
        ? dot(subtract(currentTarget, active.initialTargetPosition), active.workVector)
        : 0;
      const loadPosition = active.request.loadId
        ? this.physics.bodyPosition(active.request.loadId)
        : undefined;
      const loadTravel = loadPosition && active.initialLoadPosition
        ? distance3(loadPosition, active.initialLoadPosition)
        : 0;
      if (
        active.request.loadTravel &&
        loadTravel >= active.request.loadTravel
      ) {
        this.complete(
          `The ${plainObject(this.physics.records.get(targetId)!)} moves its load ${loadTravel.toFixed(2)} metres through contact.`,
        );
        return;
      }
      const maximumWorkSeconds = active.request.targetPort === "assembly-push" ? 15 : 4.5;
      if (
        (active.request.targetPort !== "supported-center" &&
          strokeProgress > Math.max(.18, active.request.magnitude ?? .35)) ||
        active.phaseElapsed > maximumWorkSeconds
      ) {
        this.complete(`The ${plainObject(this.physics.records.get(targetId)!)} moves ${moved.toFixed(2)} metres under worker contact.`);
      }
    }
  }

  private completeSupportedHold(active: ActiveAction, text: string): void {
    const targetId = active.request.targetId;
    if (!targetId) return this.cancelActive("The supported tool is gone.");
    const position = this.physics.bodyPosition(targetId);
    const rotation = this.physics.bodyRotation(targetId);
    const group = this.attachCarry(targetId, active.request.actorIds, true);
    if (!position || !rotation || !group) {
      return this.cancelActive("The workers cannot recover their supported grips.");
    }
    group.targetRotation = rotation;
    group.releaseHeight = position.y;
    this.carrying.set(targetId, group);
    this.physics.setCarried(targetId, active.request.actorIds);
    this.complete(text);
  }

  private supportAssemblySecondary(active: ActiveAction, dt: number): void {
    if (
      !active.request.secondaryId ||
      !active.initialSecondaryPosition ||
      !active.initialSecondaryRotation
    ) return;
    const supportedId = active.request.secondaryId;
    const supported = this.physics.records.get(supportedId);
    const supportedPosition = this.physics.bodyPosition(supportedId);
    const supportedRotation = this.physics.bodyRotation(supportedId);
    const supportedVelocity = this.physics.bodyLinearVelocity(supportedId);
    const supportedAngularVelocity = this.physics.bodyAngularVelocity(supportedId);
    if (!supported || !supportedPosition || !supportedRotation || !supportedVelocity || !supportedAngularVelocity) {
      return;
    }
    const verticalForce = Math.max(-1_800, Math.min(
      1_800,
      (active.initialSecondaryPosition.y - supportedPosition.y) * 1_800 -
        supportedVelocity.y * 420 + 9.81 * approximateMass(supported),
    ));
    this.physics.applyImpulse(supportedId, { x: 0, y: verticalForce * dt, z: 0 });
    const supportError = quaternionAngularError(active.initialSecondaryRotation, supportedRotation);
    const supportTorque = inertialTorque(supported, supportedRotation, {
      x: supportError.x * 180 - supportedAngularVelocity.x * 30,
      y: supportError.y * 180 - supportedAngularVelocity.y * 30,
      z: supportError.z * 180 - supportedAngularVelocity.z * 30,
    });
    this.physics.applyTorqueImpulse(
      supportedId,
      scaleVector(clampVector(supportTorque, 360), dt),
    );
  }

  private updateAlign(dt: number): void {
    const active = this.requireActive();
    const targetId = active.request.targetId;
    let targetOrientation = active.request.orientation;
    if (!targetId || !targetOrientation) return this.cancelActive("Alignment needs an object and orientation.");
    const target = this.physics.records.get(targetId);
    const targetPosition = this.physics.bodyPosition(targetId);
    if (!target?.dynamic || !targetPosition) return this.cancelActive("Only a physical loose object can be aligned.");
    let destination = active.request.destination ?? targetPosition;
    if (active.request.secondaryPort === "hub-top-socket" && active.request.secondaryId) {
      const hub = this.physics.records.get(active.request.secondaryId);
      const hubPosition = this.physics.bodyPosition(active.request.secondaryId);
      const hubRotation = this.physics.bodyRotation(active.request.secondaryId);
      if (!hub || hub.family !== "hub" || !hubPosition || !hubRotation) {
        return this.cancelActive("The hub top is no longer available.");
      }
      const up = normalize(rotateVector({ x: 0, y: 1, z: 0 }, hubRotation));
      destination = add(
        hubPosition,
        scaleVector(up, hub.size.y / 2 + target.size.y / 2 - .05),
      );
    }
    if (active.request.secondaryPort?.startsWith("beam-end-") && active.request.secondaryId) {
      const beam = this.physics.records.get(active.request.secondaryId);
      const beamPosition = this.physics.bodyPosition(active.request.secondaryId);
      const beamRotation = this.physics.bodyRotation(active.request.secondaryId);
      if (!beam || beam.family !== "beam" || !beamPosition || !beamRotation) {
        return this.cancelActive("The beam-end socket is no longer available.");
      }
      const sign = active.request.secondaryPort === "beam-end-positive" ? 1 : -1;
      const beamAxis = normalize(rotateVector({ x: 0, y: 0, z: 1 }, beamRotation));
      destination = add(
        beamPosition,
        scaleVector(beamAxis, sign * (beam.size.z / 2 + target.size.y / 2 + .005)),
      );
    }
    if (active.request.secondaryPort === "bearing-bore" && active.request.secondaryId) {
      const bearingPosition = this.physics.bodyPosition(active.request.secondaryId);
      const bearingRotation = this.physics.bodyRotation(active.request.secondaryId);
      if (!bearingPosition || !bearingRotation) {
        return this.cancelActive("The bearing pose is no longer available.");
      }
      destination = bearingPosition;
      targetOrientation = bearingRotation;
    }
    if (active.request.secondaryPort?.startsWith("axle-end-") && active.request.secondaryId) {
      const axle = this.physics.records.get(active.request.secondaryId);
      const axlePosition = this.physics.bodyPosition(active.request.secondaryId);
      const axleRotation = this.physics.bodyRotation(active.request.secondaryId);
      if (!axle || axle.family !== "axle" || !axlePosition || !axleRotation) {
        return this.cancelActive("The axle end is no longer available.");
      }
      const sign = active.request.secondaryPort === "axle-end-positive" ? 1 : -1;
      const axis = rotateVector({ x: 0, y: 0, z: 1 }, axleRotation);
      destination = add(axlePosition, scaleVector(axis, sign * axle.size.z / 2));
      targetOrientation = axleRotation;
    }
    if (active.request.secondaryPort?.startsWith("axle-approach-") && active.request.secondaryId) {
      const axle = this.physics.records.get(active.request.secondaryId);
      const axlePosition = this.physics.bodyPosition(active.request.secondaryId);
      const axleRotation = this.physics.bodyRotation(active.request.secondaryId);
      if (!axle || axle.family !== "axle" || !axlePosition || !axleRotation) {
        return this.cancelActive("The axle approach is no longer available.");
      }
      const sign = active.request.secondaryPort === "axle-approach-positive" ? 1 : -1;
      const axis = rotateVector({ x: 0, y: 0, z: 1 }, axleRotation);
      destination = add(axlePosition, scaleVector(axis, sign * (axle.size.z / 2 + .27)));
      targetOrientation = axleRotation;
    }
    if (active.request.secondaryPort === "axle-chassis-bearing" && active.request.secondaryId) {
      const axle = this.physics.records.get(active.request.secondaryId);
      const axlePosition = this.physics.bodyPosition(active.request.secondaryId);
      if (!axle || axle.family !== "axle" || !axlePosition) {
        return this.cancelActive("The chassis axle is no longer available.");
      }
      const plankLong = normalize(rotateVector({ x: 0, y: 0, z: 1 }, targetOrientation));
      destination = add(axlePosition, add(scaleVector(plankLong, .5), { x: 0, y: .12, z: 0 }));
    }
    if (active.request.secondaryPort === "hub-forward-socket" && active.request.secondaryId) {
      const hub = this.physics.records.get(active.request.secondaryId);
      const hubPosition = this.physics.bodyPosition(active.request.secondaryId);
      if (!hub || hub.family !== "hub" || !hubPosition) {
        return this.cancelActive("The hub socket is no longer available.");
      }
      const socketAxisVector = rotateVector({ x: 0, y: 0, z: 1 }, targetOrientation);
      const socketAxis = scaleVector(
        socketAxisVector,
        1 / Math.max(.0001, vectorLength(socketAxisVector)),
      );
      destination = add(
        hubPosition,
        scaleVector(
          socketAxis,
          hub.size.x / 2 + HUB_SOCKET_REACH + target.size.z / 2 + .005,
        ),
      );
    }
    if (
      (active.request.secondaryPort === "plank-forward-socket" ||
        active.request.secondaryPort === "plank-forward-high") &&
      active.request.secondaryId
    ) {
      const plank = this.physics.records.get(active.request.secondaryId);
      const plankPosition = this.physics.bodyPosition(active.request.secondaryId);
      const plankRotation = this.physics.bodyRotation(active.request.secondaryId);
      if (!plank || plank.family !== "plank" || !plankPosition || !plankRotation) {
        return this.cancelActive("The chassis socket is no longer available.");
      }
      const plankForwardVector = rotateVector({ x: 0, y: 0, z: 1 }, plankRotation);
      const plankForward = scaleVector(
        plankForwardVector,
        1 / Math.max(.0001, vectorLength(plankForwardVector)),
      );
      destination = add(
        plankPosition,
        scaleVector(plankForward, plank.size.z / 2 + target.size.z / 2 + .005),
      );
      destination.y = active.request.secondaryPort === "plank-forward-high"
        ? plankPosition.y + .48
        : plankPosition.y - .028;
      targetOrientation = plankRotation;
    }
    if (active.request.secondaryPort === "plank-post-socket" && active.request.secondaryId) {
      const plank = this.physics.records.get(active.request.secondaryId);
      const plankPosition = this.physics.bodyPosition(active.request.secondaryId);
      const plankRotation = this.physics.bodyRotation(active.request.secondaryId);
      if (!plank || plank.family !== "plank" || !plankPosition || !plankRotation) {
        return this.cancelActive("The pedestal socket is no longer available.");
      }
      const plankUp = normalize(rotateVector({ x: 0, y: 1, z: 0 }, plankRotation));
      destination = add(
        plankPosition,
        scaleVector(plankUp, plank.size.y / 2 + target.size.z / 2 + .005),
      );
    }
    if (
      (active.request.secondaryPort === "plank-top-socket" ||
        active.request.secondaryPort === "plank-top-high" ||
        active.request.secondaryPort === "plank-ram-socket" ||
        active.request.secondaryPort === "plank-ram-high") &&
      active.request.secondaryId
    ) {
      const plank = this.physics.records.get(active.request.secondaryId);
      const plankPosition = this.physics.bodyPosition(active.request.secondaryId);
      const plankRotation = this.physics.bodyRotation(active.request.secondaryId);
      if (!plank || plank.family !== "plank" || !plankPosition || !plankRotation) {
        return this.cancelActive("The chassis saddle is no longer available.");
      }
      const plankForward = normalize(rotateVector({ x: 0, y: 0, z: 1 }, plankRotation));
      const plankUp = normalize(rotateVector({ x: 0, y: 1, z: 0 }, plankRotation));
      const ramSaddle = active.request.secondaryPort.startsWith("plank-ram-");
      destination = add(
        plankPosition,
        add(
          scaleVector(plankForward, RAM_SADDLE_FORWARD),
          scaleVector(
            plankUp,
            ramSaddle
              ? RAM_SADDLE_HEIGHT
              : plank.size.y / 2 + .09 + target.size.y / 2 + .005,
          ),
        ),
      );
      if (
        active.request.secondaryPort === "plank-top-high"
      ) destination.y += .48;
      if (active.request.secondaryPort === "plank-ram-high") destination.y += .26;
      targetOrientation = ramSaddle
        ? multiplyQuaternion(plankRotation, xAxisQuat(RAM_SADDLE_PITCH))
        : plankRotation;
    }
    if (active.request.secondaryPort?.startsWith("plank-bearing-") && active.request.secondaryId) {
      const plank = this.physics.records.get(active.request.secondaryId);
      const plankPosition = this.physics.bodyPosition(active.request.secondaryId);
      const plankRotation = this.physics.bodyRotation(active.request.secondaryId);
      if (!plank || plank.family !== "plank" || !plankPosition || !plankRotation) {
        return this.cancelActive("The chassis bearing is no longer available.");
      }
      const sign = active.request.secondaryPort === "plank-bearing-positive" ? 1 : -1;
      const longAxis = rotateVector({ x: 0, y: 0, z: 1 }, plankRotation);
      destination = add(
        plankPosition,
        add(scaleVector(longAxis, sign * .5), { x: 0, y: -.12, z: 0 }),
      );
      const crossAxis = rotateVector({ x: 1, y: 0, z: 0 }, plankRotation);
      targetOrientation = quatFromLocalZ(crossAxis);
    }
    if (
      active.request.secondaryPort?.startsWith("chassis-bearing-pair:") &&
      active.request.secondaryId
    ) {
      const frontAxleId = active.request.secondaryPort.slice("chassis-bearing-pair:".length);
      const rearAxle = this.physics.records.get(active.request.secondaryId);
      const frontAxle = this.physics.records.get(frontAxleId);
      const rearPosition = this.physics.bodyPosition(active.request.secondaryId);
      const frontPosition = this.physics.bodyPosition(frontAxleId);
      const rearRotation = this.physics.bodyRotation(active.request.secondaryId);
      const frontRotation = this.physics.bodyRotation(frontAxleId);
      if (
        rearAxle?.family !== "axle" || frontAxle?.family !== "axle" ||
        !rearPosition || !frontPosition || !rearRotation || !frontRotation
      ) {
        return this.cancelActive("The two chassis bearings are no longer available.");
      }
      const longAxis = normalize({
        x: frontPosition.x - rearPosition.x,
        y: 0,
        z: frontPosition.z - rearPosition.z,
      });
      destination = {
        x: (rearPosition.x + frontPosition.x) / 2,
        y: (rearPosition.y + frontPosition.y) / 2 + .12,
        z: (rearPosition.z + frontPosition.z) / 2,
      };
      const rearAxis = normalize(rotateVector({ x: 0, y: 0, z: 1 }, rearRotation));
      let frontAxis = normalize(rotateVector({ x: 0, y: 0, z: 1 }, frontRotation));
      if (dot(rearAxis, frontAxis) < 0) frontAxis = scaleVector(frontAxis, -1);
      let bearingAxis = normalize(add(rearAxis, frontAxis));
      const geometricCross = normalize(cross({ x: 0, y: 1, z: 0 }, longAxis));
      if (dot(bearingAxis, geometricCross) < 0) bearingAxis = scaleVector(bearingAxis, -1);
      const longYaw = Math.atan2(longAxis.x, longAxis.z);
      const bearingYaw = Math.atan2(-bearingAxis.z, bearingAxis.x);
      const compromiseYaw = longYaw + wrapAngle(bearingYaw - longYaw) / 2;
      targetOrientation = quatFromLocalZ({
        x: Math.sin(compromiseYaw),
        y: 0,
        z: Math.cos(compromiseYaw),
      });
    }
    let carriedTogether = this.carrying.has(targetId) &&
      active.request.actorIds.every((id) => target.carriedBy?.includes(id));
    const ramSaddleRegrip = carriedTogether && (
      active.request.secondaryPort === "plank-ram-high" ||
      active.request.secondaryPort === "plank-ram-socket"
    );
    const supportedRegrip = active.request.targetPort === "side-on" ||
      active.request.targetPort === "front-side" ||
      active.request.targetPort === "wide-front-side" ||
      active.request.targetPort === "end-grips" ||
      active.request.targetPort === "lever-carry-side" ||
      isRamOpenSide(active.request.targetPort) ||
      active.request.targetPort === "lever-effort-grips" ||
      active.request.targetPort === "pedestal-brace" ||
      active.request.targetPort === "fulcrum-outward-hold";

    if (active.phase === "starting") {
      const stagingReach =
        active.request.secondaryPort === "plank-top-high" ||
        active.request.secondaryPort === "plank-ram-high"
          ? 2.1
          : 1.1;
      if (distance3(targetPosition, destination) > stagingReach) {
        return this.cancelActive("The object is too far from its staging pose to align safely.");
      }
      if (carriedTogether && (
        active.request.targetPort === "carried-orientation" || ramSaddleRegrip
      )) {
        const group = this.carrying.get(targetId);
        if (!group) return this.cancelActive("The held object has no active grip.");
        group.targetRotation = { ...targetOrientation };
        group.releaseHeight = destination.y;
        active.initialTargetPosition = { ...targetPosition };
        active.formationFollow = false;
        active.workGoals = new Map(active.request.actorIds.map((id) => [
          id,
          this.physics.bodyPosition(id) ?? targetPosition,
        ]));
        active.phase = "work";
        active.phaseElapsed = 0;
        active.stableSeconds = 0;
        this.reserveWorkPoses(active);
        for (const id of active.request.actorIds) this.setWorkerPhase(id, "aligning");
        return;
      }
      if (carriedTogether) {
        this.carrying.delete(targetId);
        carriedTogether = false;
        this.emit({ text: `${this.actorNames(active.request.actorIds)} transfer the load from carrying grips to an alignment hold.` });
      }
      this.physics.setCarried(targetId, active.request.actorIds, false);
      active.initialTargetPosition = { ...targetPosition };
      if (supportedRegrip) {
        active.formationFollow = false;
        active.formationOffsets = undefined;
        active.workGoals = active.request.targetPort === "end-grips"
          ? this.endGripWorkGoals(
            targetId,
            active.request.actorIds,
            targetPosition,
            targetOrientation,
          )
          : active.request.targetPort === "lever-carry-side"
            ? this.leverCarrySideGoals(
              targetId,
              active.request.actorIds,
              targetPosition,
              targetOrientation,
            )
          : isRamOpenSide(active.request.targetPort)
            ? new Map(active.request.actorIds.map((id, index) => [id, {
              x: targetPosition.x + (targetPosition.x < 0 ? -1 : 1) * .68,
              y: .775,
              z: targetPosition.z + (index === 0 ? -1.08 : 1.08),
            }]))
          : active.request.targetPort === "lever-effort-grips"
            ? this.leverEffortGoals(
              targetId,
              active.request.actorIds,
              targetPosition,
              targetOrientation,
            )
          : active.request.targetPort === "fulcrum-outward-hold"
            ? this.fulcrumOutwardGoal(
              targetId,
              active.request.actorIds,
              targetPosition,
              targetOrientation,
            )
          : active.request.targetPort === "pedestal-brace"
            ? new Map(active.request.actorIds.map((id, index) => [id, {
              x: targetPosition.x - .63 - index * .35,
              y: .775,
              z: targetPosition.z + .03 + index * .3,
            }]))
          : active.request.targetPort === "front-side" ||
          active.request.targetPort === "wide-front-side"
          ? this.frontSideWorkGoals(
            targetId,
            active.request.actorIds,
            targetPosition,
            targetOrientation,
            active.request.targetPort === "wide-front-side" ? 1.12 : .92,
          )
          : this.sideOnWorkGoals(
            targetId,
            active.request.actorIds,
            targetPosition,
            targetOrientation,
          );
        active.phase = "approach";
        active.phaseElapsed = 0;
        active.stableSeconds = 0;
        if (active.request.targetPort === "lever-effort-grips") {
          for (const [id, goal] of active.workGoals) {
            const current = this.physics.bodyPosition(id);
            if (!current || current.z < .2) continue;
            active.routes.set(id, [
              { x: -2.65, y: .775, z: Math.max(1.65, current.z) },
              { x: -2.65, y: .775, z: -1.55 },
              goal,
            ]);
          }
        }
        if (active.request.targetPort === "fulcrum-outward-hold") {
          for (const [id, goal] of active.workGoals) {
            const current = this.physics.bodyPosition(id);
            if (!current) continue;
            active.routes.set(id, [
              { x: Math.min(-1.95, current.x), y: .775, z: -.25 },
              goal,
            ]);
          }
        }
        this.reserveWorkPoses(active);
        for (const id of active.request.actorIds) this.setWorkerPhase(id, "routing");
        this.emit({
          text: active.request.targetPort === "end-grips"
            ? `${this.actorNames(active.request.actorIds)} move beyond the beam ends for a clear carry.`
            : active.request.targetPort === "lever-carry-side"
              ? `${this.actorNames(active.request.actorIds)} take the open side of the long beam.`
            : isRamOpenSide(active.request.targetPort)
              ? `${this.actorNames(active.request.actorIds)} take the tower-clear side of the ram beam.`
            : active.request.targetPort === "lever-effort-grips"
              ? `${this.actorNames(active.request.actorIds)} gather behind the long effort end.`
            : active.request.targetPort === "fulcrum-outward-hold"
              ? `${this.actorNames(active.request.actorIds)} brace the wedge from the open side.`
            : active.request.targetPort === "pedestal-brace"
              ? `${this.actorNames(active.request.actorIds)} set a grounded shoulder against the pedestal.`
            : active.request.targetPort === "front-side" ||
            active.request.targetPort === "wide-front-side"
            ? `${this.actorNames(active.request.actorIds)} take the same side of the chassis load.`
            : `${this.actorNames(active.request.actorIds)} shift to balanced lever grips.`,
        });
        return;
      }
      const workersNear = active.request.actorIds.every((id) => {
        const workerPosition = this.physics.bodyPosition(id);
        return workerPosition ? horizontalDistance(workerPosition, targetPosition) < 1.65 : false;
      });
      active.formationFollow = workersNear;
      active.formationOffsets = workersNear
        ? new Map(active.request.actorIds.map((id) => {
          const workerPosition = this.physics.bodyPosition(id) ?? targetPosition;
          return [id, subtract(workerPosition, targetPosition)];
        }))
        : undefined;
      active.workGoals = workersNear
        ? new Map(active.request.actorIds.map((id) => [id, this.physics.bodyPosition(id) ?? destination]))
        : this.alignmentWorkGoals(
          targetId,
          active.request.actorIds,
          destination,
          targetOrientation,
        );
      active.phase = workersNear ? "work" : "approach";
      active.phaseElapsed = 0;
      active.stableSeconds = 0;
      this.reserveWorkPoses(active);
      if (workersNear) {
        for (const id of active.request.actorIds) this.setWorkerPhase(id, "aligning");
        return;
      }
    }

    if (active.phase === "approach") {
      if (supportedRegrip && active.initialTargetPosition) {
        const position = this.physics.bodyPosition(targetId);
        const rotation = this.physics.bodyRotation(targetId);
        const velocity = this.physics.bodyLinearVelocity(targetId);
        const angularVelocity = this.physics.bodyAngularVelocity(targetId);
        if (!position || !rotation || !velocity || !angularVelocity) {
          return this.cancelActive("The workers lose the supported regrip.");
        }
        const positionError = subtract(active.initialTargetPosition, position);
        const holdForce = clampVector({
          x: positionError.x * 320 - velocity.x * 300,
          y: positionError.y * 320 - velocity.y * 80 + 9.81 * approximateMass(target),
          z: positionError.z * 320 - velocity.z * 300,
        }, 420 * active.request.actorIds.length);
        this.physics.applyImpulse(targetId, scaleVector(holdForce, dt));
        const angularError = quaternionAngularError(targetOrientation, rotation);
        const holdTorque = inertialTorque(target, rotation, {
          x: angularError.x * 12 - angularVelocity.x * 6,
          y: angularError.y * 12 - angularVelocity.y * 6,
          z: angularError.z * 12 - angularVelocity.z * 6,
        });
        this.physics.applyTorqueImpulse(
          targetId,
          scaleVector(clampVector(holdTorque, 24 * active.request.actorIds.length), dt),
        );
      }
      let arrived = this.routeWorkers(
        active,
        active.workGoals ?? new Map(),
        1.35,
        dt,
        0,
        false,
        supportedRegrip ? 0.07 : 0.22,
      );
      const requiresDistinctFrontPositions =
        active.request.targetPort === "front-side" ||
        active.request.targetPort === "wide-front-side" ||
        active.request.targetPort === "end-grips" ||
        active.request.targetPort === "lever-carry-side" ||
        isRamOpenSide(active.request.targetPort) ||
        active.request.targetPort === "lever-effort-grips" ||
        active.request.targetPort === "fulcrum-outward-hold";
      if (!arrived && supportedRegrip && !requiresDistinctFrontPositions && active.phaseElapsed > 1.5) {
        const currentPosition = this.physics.bodyPosition(targetId);
        const currentRotation = this.physics.bodyRotation(targetId);
        const handlingRadius = Math.max(target.size.x, target.size.z) / 2 + .85;
        const workersRemainNear = currentPosition && active.request.actorIds.every((id) => {
          const workerPosition = this.physics.bodyPosition(id);
          return workerPosition
            ? horizontalDistance(workerPosition, currentPosition) < handlingRadius
            : false;
        });
        const orientationIsReady = currentRotation
          ? vectorLength(quaternionAngularError(targetOrientation, currentRotation)) < degrees(5)
          : false;
        arrived = Boolean(workersRemainNear && orientationIsReady);
      }
      if (!arrived) return this.guardTimeout(24);
      if (supportedRegrip) {
        const currentTarget = this.physics.bodyPosition(targetId) ?? destination;
        active.formationFollow = true;
        active.formationOffsets = new Map(active.request.actorIds.map((id) => {
          const workerPosition = this.physics.bodyPosition(id) ?? currentTarget;
          return [id, subtract(workerPosition, currentTarget)];
        }));
      }
      active.phase = "work";
      active.phaseElapsed = 0;
      active.stableSeconds = 0;
      for (const id of active.request.actorIds) this.setWorkerPhase(id, "aligning");
      return;
    }

    if (active.phase !== "work") return;
    const position = this.physics.bodyPosition(targetId);
    const rotation = this.physics.bodyRotation(targetId);
    const velocity = this.physics.bodyLinearVelocity(targetId);
    const angularVelocity = this.physics.bodyAngularVelocity(targetId);
    if (!position || !rotation || !velocity || !angularVelocity) {
      return this.cancelActive("The staged object no longer has a physical pose.");
    }

    const positionError = subtract(destination, position);
    if (active.formationFollow) {
      for (const id of active.request.actorIds) {
        const worker = this.workers.get(id);
        const workerPosition = this.physics.bodyPosition(id);
        const offset = active.formationOffsets?.get(id);
        if (!worker || !workerPosition || !offset) continue;
        const goal = add(position, offset);
        const dx = goal.x - workerPosition.x;
        const dz = goal.z - workerPosition.z;
        const horizontal = Math.hypot(dx, dz);
        if (horizontal <= .01) continue;
        const amount = Math.min(horizontal, 1.15 * dt);
        const facing = { x: dx / horizontal, y: 0, z: dz / horizontal };
        const movement = this.physics.moveCharacter(
          id,
          { x: facing.x * amount, y: -.035, z: facing.z * amount },
          facing,
        );
        if (movement && Math.hypot(movement.moved.x, movement.moved.z) > .0001) worker.facing = facing;
      }
    }
    const preciseBeamSocket = target.family === "beam" &&
      active.request.actorIds.length > 1 &&
      (active.request.secondaryPort === "hub-forward-socket" ||
        active.request.secondaryPort === "plank-forward-socket" ||
        active.request.secondaryPort === "plank-post-socket" ||
        active.request.secondaryPort === "plank-top-socket" ||
        active.request.secondaryPort === "plank-ram-socket");
    const preciseBeamApproach = target.family === "beam" &&
      active.request.actorIds.length > 1 &&
      (active.request.secondaryPort === "plank-forward-high" ||
        active.request.secondaryPort === "plank-top-high" ||
        active.request.secondaryPort === "plank-ram-high");
    const chassisPairId = active.request.secondaryPort?.startsWith("chassis-bearing-pair:")
      ? active.request.secondaryPort.slice("chassis-bearing-pair:".length)
      : undefined;
    const preciseChassisPair = target.family === "plank" &&
      Boolean(active.request.secondaryId && chassisPairId);
    const preciseAxleBearing = target.family === "axle" &&
      active.request.secondaryPort?.startsWith("plank-bearing-");
    const preciseChassisBearing = target.family === "plank" &&
      active.request.secondaryPort === "axle-chassis-bearing";
    const preciseWheelsetHold = target.family === "axle" &&
      active.request.targetPort === "assembly-hold" &&
      this.connections.filter((connection) =>
        connection.class === "KEYED_COAXIAL" &&
        (connection.bodyA === targetId || connection.bodyB === targetId)
      ).length >= 2;
    const ramSaddleAlignment = target.family === "beam" && (
      active.request.secondaryPort === "plank-ram-high" ||
      active.request.secondaryPort === "plank-ram-socket"
    );
    const preciseHardware = preciseBeamSocket || preciseBeamApproach || preciseChassisPair ||
      preciseAxleBearing || preciseChassisBearing || preciseWheelsetHold;
    const alignmentPositionGain = ramSaddleAlignment ? 1_800 : preciseHardware ? 900 : 320;
    const alignmentPositionDamping = ramSaddleAlignment ? 450 : preciseHardware ? 350 : 300;
    const rawForce = {
      x: positionError.x * alignmentPositionGain - velocity.x * alignmentPositionDamping,
      y: positionError.y * alignmentPositionGain - velocity.y * (preciseHardware ? 220 : 80) +
        9.81 * approximateMass(target),
      z: positionError.z * alignmentPositionGain - velocity.z * alignmentPositionDamping,
    };
    const workerForceLimit = ramSaddleAlignment
      ? 3_000
      : preciseHardware ? 1_200 : 420 * active.request.actorIds.length;
    const force = clampVector(rawForce, workerForceLimit);
    this.physics.applyImpulse(targetId, scaleVector(force, dt));

    const angularError = quaternionAngularError(targetOrientation, rotation);
    const currentAxleAxis = preciseWheelsetHold
      ? normalize(rotateVector({ x: 0, y: 0, z: 1 }, rotation))
      : undefined;
    const targetAxleAxis = preciseWheelsetHold
      ? normalize(rotateVector({ x: 0, y: 0, z: 1 }, targetOrientation))
      : undefined;
    const constrainedAngularError = currentAxleAxis
      ? subtract(angularError, scaleVector(currentAxleAxis, dot(angularError, currentAxleAxis)))
      : angularError;
    const constrainedAngularVelocity = currentAxleAxis
      ? subtract(angularVelocity, scaleVector(currentAxleAxis, dot(angularVelocity, currentAxleAxis)))
      : angularVelocity;
    const alignmentAngularGain = target.family === "wedge" ? 30 : ramSaddleAlignment ? 50 : preciseHardware ? 28 : 12;
    const alignmentAngularDamping = target.family === "wedge" ? 12 : ramSaddleAlignment ? 16 : preciseHardware ? 10 : 6;
    const desiredAngularAcceleration = {
      x: constrainedAngularError.x * alignmentAngularGain -
        constrainedAngularVelocity.x * alignmentAngularDamping,
      y: constrainedAngularError.y * alignmentAngularGain -
        constrainedAngularVelocity.y * alignmentAngularDamping,
      z: constrainedAngularError.z * alignmentAngularGain -
        constrainedAngularVelocity.z * alignmentAngularDamping,
    };
    const workerTorqueLimit = target.family === "wedge"
      ? 320
      : ramSaddleAlignment
        ? 500
      : preciseHardware
        ? 180
        : 24 * active.request.actorIds.length;
    const torque = inertialTorque(target, rotation, desiredAngularAcceleration);
    this.physics.applyTorqueImpulse(targetId, scaleVector(clampVector(torque, workerTorqueLimit), dt));

    const positionDistance = distance3(position, destination);
    const angularDistance = currentAxleAxis && targetAxleAxis
      ? Math.acos(Math.min(1, Math.abs(dot(currentAxleAxis, targetAxleAxis))))
      : vectorLength(angularError);
    const slowEnough = vectorLength(velocity) < 0.09 && vectorLength(angularVelocity) < 0.12;
    const hubTopReady = active.request.secondaryPort === "hub-top-socket" && active.request.secondaryId
      ? this.physics.contactCount(targetId, active.request.secondaryId) > 0
      : false;
    const physicalPortsReady = preciseChassisPair && active.request.secondaryId && chassisPairId
      ? this.axlePlankPortsAreAligned(active.request.secondaryId, targetId) &&
        this.axlePlankPortsAreAligned(chassisPairId, targetId)
      : active.request.secondaryPort === "hub-top-socket"
        ? hubTopReady
      : !preciseBeamSocket || !active.request.secondaryId ||
        (active.request.secondaryPort === "plank-forward-socket" ||
          active.request.secondaryPort === "plank-top-socket" ||
          active.request.secondaryPort === "plank-ram-socket"
          ? this.beamPlankPortsAreAligned(targetId, active.request.secondaryId)
          : this.beamHubPortsAreAligned(targetId, active.request.secondaryId));
    const positionReady = active.request.secondaryPort === "hub-top-socket"
      ? positionDistance < .08
      : preciseWheelsetHold
        ? positionDistance < .08
      : ramSaddleAlignment ? positionDistance < .06 : positionDistance < .03;
    if (positionReady && angularDistance < degrees(5) && slowEnough && physicalPortsReady) {
      active.stableSeconds += dt;
    } else {
      active.stableSeconds = 0;
    }
    if (active.stableSeconds >= 0.35) {
      const heldGroup = this.carrying.get(targetId);
      const group = heldGroup ?? this.attachCarry(targetId, active.request.actorIds, true);
      if (!group) return this.cancelActive("The workers cannot keep a supported hold.");
      group.targetRotation = { ...(preciseWheelsetHold ? rotation : targetOrientation) };
      group.releaseHeight = destination.y;
      if (preciseChassisBearing || preciseWheelsetHold) {
        group.assemblyBrace = true;
        group.supportsWeight = preciseWheelsetHold;
      }
      if (group.gripAngle !== undefined) group.gripTargetAngle = group.gripAngle;
      this.carrying.set(targetId, group);
      this.physics.setCarried(targetId, active.request.actorIds);
      if (preciseWheelsetHold) {
        this.setConnectedWheelsetCarried(targetId, active.request.actorIds);
      }
      this.complete(`${this.actorNames(active.request.actorIds)} hold the ${plainObject(target)} within fastening tolerance.`);
    } else if (active.totalElapsed > (ramSaddleAlignment ? 30 : 18)) {
      this.cancelActive("The workers cannot hold that alignment within tolerance.");
    }
  }

  private updateTension(dt: number): void {
    const active = this.requireActive();
    const ropeId = active.request.targetId;
    const rope = ropeId ? this.physics.records.get(ropeId) : undefined;
    if (!ropeId || rope?.family !== "rope") {
      return this.cancelActive("Tension needs one of the visible rope pieces.");
    }
    if (active.phase === "starting") {
      if (active.request.targetPort === "hoist-tension-stance") {
        active.phase = "work";
        active.phaseElapsed = 0;
        for (const id of active.request.actorIds) this.setWorkerPhase(id, "pulling");
        return;
      }
      active.workGoals = this.workGoals(ropeId, active.request.actorIds);
      active.phase = "approach";
      active.phaseElapsed = 0;
      this.reserveWorkPoses(active);
      for (const id of active.request.actorIds) this.setWorkerPhase(id, "routing");
      return;
    }
    if (active.phase === "approach") {
      const arrived = this.routeWorkers(active, active.workGoals ?? new Map(), 1.55, dt, 0);
      if (!arrived) return this.guardTimeout(28);
      active.phase = "work";
      active.phaseElapsed = 0;
      for (const id of active.request.actorIds) this.setWorkerPhase(id, "pulling");
      return;
    }
    if (active.phase !== "work") return;
    const ropeConnections = this.connections.filter((connection) =>
      connection.class === "ROPE_ATTACH" &&
      (connection.bodyA === ropeId || connection.bodyB === ropeId));
    if (ropeConnections.length < 2) {
      return this.cancelActive("A routed line needs both a sheave and a load attachment.");
    }
    if (!active.initialRopeLengths) {
      active.initialRopeLengths = new Map();
      for (const connection of ropeConnections) {
        const first = this.physics.bodyPosition(connection.bodyA);
        const second = this.physics.bodyPosition(connection.bodyB);
        if (!first || !second) continue;
        const distance = distance3(first, second);
        active.initialRopeLengths.set(connection.id, distance);
        this.physics.setRopeJointLength(connection.id, distance + .04);
      }
      this.emit({
        text: `${this.actorNames(active.request.actorIds)} take up the visible slack and begin hauling.`,
        actorId: active.request.actorIds[0],
        team: this.workers.get(active.request.actorIds[0] ?? "")?.team,
      });
    }
    const duration = 4;
    const progress = Math.min(1, active.phaseElapsed / duration);
    if (progress === 1 || active.phaseElapsed - active.lastRopeLengthUpdate >= .08) {
      const reelDistance = Math.max(.1, Math.min(.65, active.request.magnitude ?? .35));
      for (const connection of ropeConnections) {
        const initialLength = active.initialRopeLengths.get(connection.id);
        if (initialLength === undefined) continue;
        const receiverId = connection.bodyA === ropeId ? connection.bodyB : connection.bodyA;
        const receiver = this.physics.records.get(receiverId);
        const targetLength = receiver?.family === "sheave" || receiver?.family === "drum"
          ? Math.max(.12, initialLength + .02)
          : Math.max(.15, initialLength - reelDistance * smoothStep(progress));
        this.physics.setRopeJointLength(connection.id, targetLength);
      }
      active.lastRopeLengthUpdate = active.phaseElapsed;
      this.refreshRopeStates();
    }
    for (const id of active.request.actorIds) this.setWorkerPhase(id, "pulling");
    if (progress >= 1) {
      this.complete(`${this.actorNames(active.request.actorIds)} hold the routed line under measured tension.`);
    }
  }

  private refreshRopeStates(): void {
    for (const connection of this.connections) {
      if (connection.class !== "ROPE_ATTACH") continue;
      const first = this.physics.bodyPosition(connection.bodyA);
      const second = this.physics.bodyPosition(connection.bodyB);
      const length = this.physics.ropeJointLength(connection.id);
      if (!first || !second || length === undefined) continue;
      const slack = Math.max(0, length - distance3(first, second));
      const receiverId = this.physics.records.get(connection.bodyA)?.family === "rope"
        ? connection.bodyB
        : connection.bodyA;
      const receiver = this.physics.records.get(receiverId);
      connection.slack = slack;
      connection.tension = slack < .055 && receiver
        ? Math.round(approximateMass(receiver) * 9.81)
        : 0;
    }
  }

  private updateTimed(dt: number): void {
    const active = this.requireActive();
    if (
      active.phase === "starting" &&
      active.request.action === "wait" &&
      active.request.destination
    ) {
      active.workGoals = new Map(active.request.actorIds.map((id, index) => [id, {
        ...active.request.destination!,
        y: .775,
        z: active.request.destination!.z + index * .45,
      }]));
      active.phase = "approach";
      active.phaseElapsed = 0;
      this.reserveWorkPoses(active);
      for (const id of active.request.actorIds) this.setWorkerPhase(id, "routing");
      return;
    }
    if (active.phase === "approach") {
      const arrived = this.routeWorkers(active, active.workGoals ?? new Map(), 1.65, dt, 0);
      if (!arrived) return this.guardTimeout(28);
      active.initialTargetPosition = active.request.destination;
      active.initialTargetRotation = active.request.orientation;
      active.phase = "work";
      active.phaseElapsed = 0;
    }
    if (active.phase === "starting") {
      active.initialTargetPosition = active.request.destination ?? (active.request.targetId
        ? this.physics.bodyPosition(active.request.targetId)
        : undefined);
      active.initialTargetRotation = active.request.orientation ?? (active.request.targetId
        ? this.physics.bodyRotation(active.request.targetId)
        : undefined);
      if (
        active.request.action === "hold" &&
        active.request.targetPort === "brace-assembly" &&
        active.request.targetId
      ) {
        const targetPosition = this.physics.bodyPosition(active.request.targetId);
        const target = this.physics.records.get(active.request.targetId);
        const group = this.attachCarry(active.request.targetId, active.request.actorIds, true);
        if (!targetPosition || !target || !group) {
          return this.cancelActive("The worker cannot take a physical brace on the assembly.");
        }
        group.releaseHeight = targetPosition.y;
        group.targetRotation = active.request.orientation ?? group.targetRotation;
        group.supportsWeight = target.family === "plank";
        group.assemblyBrace = true;
        if (group.gripAngle !== undefined) group.gripTargetAngle = group.gripAngle;
        this.carrying.set(active.request.targetId, group);
        this.physics.setCarried(active.request.targetId, active.request.actorIds);
      }
      active.phase = "work";
      active.phaseElapsed = 0;
    }
    for (const id of active.request.actorIds) {
      this.setWorkerPhase(id, active.request.action === "hold" ? "holding" : "testing");
    }
    if (
      active.request.action === "test" &&
      active.request.targetId &&
      active.initialTargetPosition &&
      active.initialTargetRotation &&
      this.physics.records.get(active.request.targetId)?.family === "beam" &&
      this.connections.some((connection) =>
        connection.bodyA === active.request.targetId || connection.bodyB === active.request.targetId)
    ) {
      const targetId = active.request.targetId;
      const target = this.physics.records.get(targetId);
      const position = this.physics.bodyPosition(targetId);
      const rotation = this.physics.bodyRotation(targetId);
      const velocity = this.physics.bodyLinearVelocity(targetId);
      const angularVelocity = this.physics.bodyAngularVelocity(targetId);
      if (target && position && rotation && velocity && angularVelocity) {
        const verticalForce = Math.max(-600, Math.min(
          600,
          (active.initialTargetPosition.y - position.y) * 650 - velocity.y * 220 +
            9.81 * approximateMass(target),
        ));
        this.physics.applyImpulse(targetId, { x: 0, y: verticalForce * dt, z: 0 });
        const angularError = quaternionAngularError(active.initialTargetRotation, rotation);
        const torque = inertialTorque(target, rotation, {
          x: angularError.x * 24 - angularVelocity.x * 10,
          y: angularError.y * 24 - angularVelocity.y * 10,
          z: angularError.z * 24 - angularVelocity.z * 10,
        });
        this.physics.applyTorqueImpulse(targetId, scaleVector(clampVector(torque, 180), dt));
      }
    }
    if (active.phaseElapsed >= Math.max(0.5, active.request.magnitude ?? 1.2)) {
      if (active.request.action === "test" && active.request.targetId) {
        for (const connection of this.connections) {
          if (connection.bodyA === active.request.targetId || connection.bodyB === active.request.targetId) {
            connection.tested = true;
          }
        }
      }
      if (active.request.action === "hold" && active.request.targetPort === "brace-assembly") {
        this.complete(`${this.actorNames(active.request.actorIds)} keep a grounded hand on the chassis.`, false);
        return;
      }
      this.complete(`${this.actorNames(active.request.actorIds)} finish the ${actionLabel(active.request.action).toLowerCase()} check.`);
    }
  }

  private updateConnect(dt: number): void {
    const active = this.requireActive();
    const firstId = active.request.targetId;
    const secondId = active.request.secondaryId;
    if (!firstId || !secondId) return this.cancelActive("A connection needs two pieces.");
    const first = this.physics.records.get(firstId);
    const second = this.physics.records.get(secondId);
    const connectionClass = active.request.connectionClass;
    if (!connectionClass) return this.cancelActive("The connection class is missing.");
    if (!first || !second) return this.cancelActive("One of the connection pieces is missing.");
    if (active.phase === "starting") {
      if (first.kind !== "part" || second.kind !== "part") {
        return this.cancelActive("Only visible kit pieces can be fastened here.");
      }
      if (first.stored || second.stored) {
        return this.cancelActive("Stored pieces cannot fasten themselves.");
      }
      if (this.connections.some((connection) =>
        (connection.bodyA === firstId && connection.bodyB === secondId) ||
        (connection.bodyA === secondId && connection.bodyB === firstId))) {
        return this.cancelActive("Those pieces are already connected.");
      }
      if (!this.connectionPoseIsPhysical(firstId, secondId, connectionClass)) {
        return this.cancelActive("The visible collars are not touching; the workers stop.");
      }
      const firstPosition = this.physics.bodyPosition(firstId);
      const secondPosition = this.physics.bodyPosition(secondId);
      if (!firstPosition || !secondPosition) return this.cancelActive("The connection pose is missing.");
      active.initialTargetPosition = firstPosition;
      active.initialTargetRotation = this.physics.bodyRotation(firstId);
      active.initialSecondaryPosition = secondPosition;
      active.initialSecondaryRotation = this.physics.bodyRotation(secondId);
      const heldPlankId = first.family === "plank"
        ? firstId
        : second.family === "plank" ? secondId : undefined;
      if (heldPlankId) {
        active.initialSecondaryPosition = this.physics.bodyPosition(heldPlankId);
        active.initialSecondaryRotation = this.physics.bodyRotation(heldPlankId);
        const backgroundBrace = this.carrying.get(heldPlankId);
        if (
          !backgroundBrace ||
          backgroundBrace.actorIds.some((id) => active.request.actorIds.includes(id))
        ) {
          this.carrying.delete(heldPlankId);
        }
      }
      const carriedBeamId = first.family === "beam"
        ? firstId
        : second.family === "beam" ? secondId : undefined;
      if (
        carriedBeamId &&
        (first.family === "hub" || second.family === "hub" ||
          first.family === "plank" || second.family === "plank")
      ) {
        this.carrying.delete(carriedBeamId);
      }
      if (connectionClass === "AXLE_BEARING" || connectionClass === "KEYED_COAXIAL") {
        for (const bodyId of [firstId, secondId]) {
          const group = this.carrying.get(bodyId);
          if (
            !group ||
            connectionClass === "AXLE_BEARING" ||
            group.actorIds.some((actorId) => active.request.actorIds.includes(actorId))
          ) {
            this.carrying.delete(bodyId);
            this.physics.clearCarried(bodyId);
          }
        }
      }
      if (connectionClass === "AXLE_BEARING") {
        const axleId = first.family === "axle" ? firstId : secondId;
        this.clearConnectedWheelsetCarried(axleId);
      }
      const beamAtRamSocket = active.request.secondaryPort === "plank-ram-socket"
        ? first.family === "beam" ? firstPosition : second.family === "beam" ? secondPosition : undefined
        : undefined;
      const workPoint = beamAtRamSocket ?? scaleVector(add(firstPosition, secondPosition), .5);
      const hardwareReach = active.request.secondaryPort === "plank-ram-socket" ? 4 : 1.65;
      const workersInReach = active.request.actorIds.every((id) => {
        const position = this.physics.bodyPosition(id);
        return position ? distance3(position, workPoint) < hardwareReach : false;
      });
      if (!workersInReach) return this.cancelActive("A named worker must remain within reach of the hardware.");
      if (connectionClass === "AXLE_BEARING") {
        const id = connectionId(connectionClass, firstId, secondId);
        if (!this.physics.createAssemblyJoint(id, connectionClass, firstId, secondId)) {
          return this.cancelActive("The physical pin cannot enter the aligned bearing.");
        }
        active.inProgressConnectionId = id;
      }
      active.phase = "work";
      active.phaseElapsed = 0;
      for (const id of active.request.actorIds) this.setWorkerPhase(id, "fastening");
      return;
    }
    if (active.phase !== "work") return;
    this.holdBeamAtSocket(
      firstId,
      secondId,
      active.initialTargetRotation,
      active.request.secondaryPort,
      dt,
    );
    this.holdPlankDuringFastening(
      firstId,
      secondId,
      active.initialSecondaryPosition,
      active.initialSecondaryRotation,
      active.request.secondaryPort,
      dt,
    );
    if (connectionClass === "AXLE_BEARING" || connectionClass === "KEYED_COAXIAL") {
      this.holdCoaxialHardwareDuringFastening(
        firstId,
        secondId,
        active.initialTargetPosition,
        active.initialTargetRotation,
        active.initialSecondaryPosition,
        active.initialSecondaryRotation,
        dt,
      );
    }
    if (active.phaseElapsed < .75) return;
    if (!this.connectionPoseIsPhysical(firstId, secondId, connectionClass)) {
      if (active.phaseElapsed < 2.5) return;
      return this.cancelActive("The pieces separate before the pin closes.");
    }
    const id = active.inProgressConnectionId ?? connectionId(connectionClass, firstId, secondId);
    if (!active.inProgressConnectionId &&
      !this.physics.createAssemblyJoint(id, connectionClass, firstId, secondId)) {
      return this.cancelActive("The physical joint cannot close.");
    }
    for (const bodyId of [firstId, secondId]) {
      const group = this.carrying.get(bodyId);
      if (!group || !group.actorIds.some((actorId) => active.request.actorIds.includes(actorId))) {
        continue;
      }
      this.carrying.delete(bodyId);
      this.physics.clearCarried(bodyId);
    }
    const firstPosition = this.physics.bodyPosition(firstId);
    const secondPosition = this.physics.bodyPosition(secondId);
    const ropeDistance = firstPosition && secondPosition
      ? distance3(firstPosition, secondPosition)
      : 3.42;
    const ropeReceiver = first.family === "rope" ? second : first;
    const ropeLength = ropeReceiver.family === "sheave" || ropeReceiver.family === "drum"
      ? Math.min(ropeDistance + .02, .22)
      : Math.min(3.5, ropeDistance + .08);
    if (connectionClass === "ROPE_ATTACH") this.physics.setRopeJointLength(id, ropeLength);
    const ropeSlack = Math.max(0, ropeLength - ropeDistance);
    this.connections.push({
      id,
      class: connectionClass,
      bodyA: firstId,
      bodyB: secondId,
      actorIds: [...active.request.actorIds],
      createdTick: this.physics.tick,
      tested: false,
      ...(connectionClass === "ROPE_ATTACH" ? { tension: 0, slack: ropeSlack } : {}),
    });
    this.complete(
      connectionCompletionText(
        connectionClass,
        this.actorNames(active.request.actorIds),
        plainObject(first.family === "axle" || first.family === "rope" ? second : first),
      ),
    );
  }

  private connectionPoseIsPhysical(
    firstId: string,
    secondId: string,
    requestedClass: ConnectionClass,
  ): boolean {
    const first = this.physics.records.get(firstId);
    const second = this.physics.records.get(secondId);
    if (!first || !second ||
      !connectionClassSupportsFamilies(requestedClass, first.family, second.family)) return false;
    if (requestedClass === "TENON_LOCK") {
      const beam = first?.family === "beam" ? first : second?.family === "beam" ? second : undefined;
      const hub = first?.family === "hub" ? first : second?.family === "hub" ? second : undefined;
      if (beam && hub) return this.beamHubPortsAreAligned(beam.id, hub.id);
      const plank = first?.family === "plank" ? first : second?.family === "plank" ? second : undefined;
      if (beam && plank) return this.beamPlankPortsAreAligned(beam.id, plank.id);
      const wedge = first?.family === "wedge" ? first : second?.family === "wedge" ? second : undefined;
      const drum = first?.family === "drum" ? first : second?.family === "drum" ? second : undefined;
      if (beam && (wedge || drum)) return this.physics.contactCount(firstId, secondId) > 0;
      return false;
    }
    if (requestedClass === "ROPE_ATTACH") {
      const firstPosition = this.physics.bodyPosition(firstId);
      const secondPosition = this.physics.bodyPosition(secondId);
      return Boolean(firstPosition && secondPosition && distance3(firstPosition, secondPosition) < .82);
    }
    const axle = first?.family === "axle" ? first : second?.family === "axle" ? second : undefined;
    const plank = first?.family === "plank" ? first : second?.family === "plank" ? second : undefined;
    if (requestedClass === "AXLE_BEARING" && axle && plank) {
      return this.axlePlankPortsAreAligned(axle.id, plank.id);
    }
    const bearing = first?.family === "wheel" || first?.family === "hub" ||
        first?.family === "sheave" || first?.family === "drum"
      ? first
      : second?.family === "wheel" || second?.family === "hub" ||
          second?.family === "sheave" || second?.family === "drum"
        ? second
        : undefined;
    if (!axle || !bearing) return false;
    const axlePosition = this.physics.bodyPosition(axle.id);
    const bearingPosition = this.physics.bodyPosition(bearing.id);
    const axleRotation = this.physics.bodyRotation(axle.id);
    const bearingRotation = this.physics.bodyRotation(bearing.id);
    if (!axlePosition || !bearingPosition || !axleRotation || !bearingRotation) return false;
    const axleAxis = rotateVector({ x: 0, y: 0, z: 1 }, axleRotation);
    const bearingAxis = rotateVector({ x: 0, y: 0, z: 1 }, bearingRotation);
    const separation = subtract(bearingPosition, axlePosition);
    const axialDistance = dot(separation, axleAxis);
    const radialOffset = subtract(separation, scaleVector(axleAxis, axialDistance));
    const expectedAxialDistance = requestedClass === "AXLE_BEARING" ? 0 : axle.size.z / 2;
    const angleTolerance = requestedClass === "KEYED_COAXIAL" ? 8 : 10;
    return (
      vectorLength(radialOffset) < .03 &&
      Math.abs(Math.abs(axialDistance) - expectedAxialDistance) < .03 &&
      Math.abs(dot(axleAxis, bearingAxis)) > Math.cos(degrees(angleTolerance))
    );
  }

  private holdBeamAtSocket(
    firstId: string,
    secondId: string,
    targetRotation: Quat | undefined,
    secondaryPort: string | undefined,
    dt: number,
  ): void {
    const first = this.physics.records.get(firstId);
    const second = this.physics.records.get(secondId);
    const beam = first?.family === "beam" ? first : second?.family === "beam" ? second : undefined;
    const hub = first?.family === "hub" ? first : second?.family === "hub" ? second : undefined;
    const plank = first?.family === "plank" ? first : second?.family === "plank" ? second : undefined;
    if (!beam || (!hub && !plank) || !targetRotation) return;
    const beamPosition = this.physics.bodyPosition(beam.id);
    const socketPosition = this.physics.bodyPosition((hub ?? plank)!.id);
    const beamRotation = this.physics.bodyRotation(beam.id);
    const velocity = this.physics.bodyLinearVelocity(beam.id);
    const angularVelocity = this.physics.bodyAngularVelocity(beam.id);
    if (!beamPosition || !socketPosition || !beamRotation || !velocity || !angularVelocity) return;
    const socketAxisVector = rotateVector({ x: 0, y: 0, z: 1 }, targetRotation);
    const socketAxis = scaleVector(
      socketAxisVector,
      1 / Math.max(.0001, vectorLength(socketAxisVector)),
    );
    let destination: Vec3;
    if (
      plank &&
      (secondaryPort === "plank-post-socket" ||
        secondaryPort === "plank-top-socket" || secondaryPort === "plank-ram-socket")
    ) {
      const plankRotation = this.physics.bodyRotation(plank.id);
      if (!plankRotation) return;
      const socketUp = normalize(rotateVector({ x: 0, y: 1, z: 0 }, plankRotation));
      const plankForward = normalize(rotateVector({ x: 0, y: 0, z: 1 }, plankRotation));
      const ramSaddle = secondaryPort === "plank-ram-socket";
      destination = secondaryPort === "plank-post-socket"
        ? add(
          socketPosition,
          scaleVector(socketUp, plank.size.y / 2 + beam.size.z / 2 + .005),
        )
        : add(
          socketPosition,
          add(
            scaleVector(plankForward, RAM_SADDLE_FORWARD),
            scaleVector(
              socketUp,
              ramSaddle
                ? RAM_SADDLE_HEIGHT
                : plank.size.y / 2 + .09 + beam.size.y / 2 + .005,
            ),
          ),
        );
    } else {
      const side = dot(subtract(beamPosition, socketPosition), socketAxis) >= 0 ? 1 : -1;
      const socketHalfLength = hub
        ? hub.size.x / 2 + HUB_SOCKET_REACH
        : plank!.size.z / 2;
      destination = add(
        socketPosition,
        scaleVector(socketAxis, side * (socketHalfLength + beam.size.z / 2 + .005)),
      );
      if (plank) destination.y = socketPosition.y - .028;
    }
    const error = subtract(destination, beamPosition);
    const force = clampVector({
      x: error.x * 1_800 - velocity.x * 500,
      y: error.y * 1_800 - velocity.y * 420 + 9.81 * approximateMass(beam),
      z: error.z * 1_800 - velocity.z * 500,
    }, 1_800);
    this.physics.applyImpulse(beam.id, scaleVector(force, dt));
    const angularError = quaternionAngularError(targetRotation, beamRotation);
    const torque = inertialTorque(beam, beamRotation, {
      x: angularError.x * 180 - angularVelocity.x * 30,
      y: angularError.y * 180 - angularVelocity.y * 30,
      z: angularError.z * 180 - angularVelocity.z * 30,
    });
    this.physics.applyTorqueImpulse(beam.id, scaleVector(clampVector(torque, 360), dt));
  }

  private holdPlankDuringFastening(
    firstId: string,
    secondId: string,
    targetPosition: Vec3 | undefined,
    targetRotation: Quat | undefined,
    secondaryPort: string | undefined,
    dt: number,
  ): void {
    const first = this.physics.records.get(firstId);
    const second = this.physics.records.get(secondId);
    const plank = first?.family === "plank" ? first : second?.family === "plank" ? second : undefined;
    if (!plank || !targetPosition || !targetRotation) return;
    if (secondaryPort?.startsWith("chassis-bearing-other:")) {
      const otherAxleId = secondaryPort.slice("chassis-bearing-other:".length);
      const primaryAxle = first?.family === "axle" ? first : second?.family === "axle" ? second : undefined;
      const otherAxle = this.physics.records.get(otherAxleId);
      const primaryPosition = primaryAxle ? this.physics.bodyPosition(primaryAxle.id) : undefined;
      const otherPosition = this.physics.bodyPosition(otherAxleId);
      if (primaryAxle && otherAxle?.family === "axle" && primaryPosition && otherPosition) {
        const rear = primaryPosition.x <= otherPosition.x ? primaryPosition : otherPosition;
        const front = primaryPosition.x <= otherPosition.x ? otherPosition : primaryPosition;
        targetPosition = {
          x: (rear.x + front.x) / 2,
          y: (rear.y + front.y) / 2 + .12,
          z: (rear.z + front.z) / 2,
        };
      }
    }
    const position = this.physics.bodyPosition(plank.id);
    const rotation = this.physics.bodyRotation(plank.id);
    const velocity = this.physics.bodyLinearVelocity(plank.id);
    const angularVelocity = this.physics.bodyAngularVelocity(plank.id);
    if (!position || !rotation || !velocity || !angularVelocity) return;
    const error = subtract(targetPosition, position);
    const force = clampVector({
      x: error.x * 5_000 - velocity.x * 900,
      y: error.y * 5_000 - velocity.y * 720 + 9.81 * approximateMass(plank),
      z: error.z * 5_000 - velocity.z * 900,
    }, 5_000);
    this.physics.applyImpulse(plank.id, scaleVector(force, dt));
    const angularError = quaternionAngularError(targetRotation, rotation);
    const torque = inertialTorque(plank, rotation, {
      x: angularError.x * 600 - angularVelocity.x * 90,
      y: angularError.y * 600 - angularVelocity.y * 90,
      z: angularError.z * 600 - angularVelocity.z * 90,
    });
    this.physics.applyTorqueImpulse(plank.id, scaleVector(clampVector(torque, 1_200), dt));
  }

  private holdCoaxialHardwareDuringFastening(
    firstId: string,
    secondId: string,
    firstTargetPosition: Vec3 | undefined,
    firstTargetRotation: Quat | undefined,
    secondTargetPosition: Vec3 | undefined,
    secondTargetRotation: Quat | undefined,
    dt: number,
  ): void {
    const holds = [
      { id: firstId, position: firstTargetPosition, rotation: firstTargetRotation },
      { id: secondId, position: secondTargetPosition, rotation: secondTargetRotation },
    ];
    for (const hold of holds) {
      const record = this.physics.records.get(hold.id);
      if (record?.family === "plank") continue;
      const position = this.physics.bodyPosition(hold.id);
      const rotation = this.physics.bodyRotation(hold.id);
      const velocity = this.physics.bodyLinearVelocity(hold.id);
      const angularVelocity = this.physics.bodyAngularVelocity(hold.id);
      if (
        !record || !hold.position || !hold.rotation || !position || !rotation ||
        !velocity || !angularVelocity
      ) continue;
      const error = subtract(hold.position, position);
      const force = clampVector({
        x: error.x * 5_000 - velocity.x * 900,
        y: error.y * 5_000 - velocity.y * 720 + 9.81 * approximateMass(record),
        z: error.z * 5_000 - velocity.z * 900,
      }, 5_000);
      this.physics.applyImpulse(hold.id, scaleVector(force, dt));
      const angularError = quaternionAngularError(hold.rotation, rotation);
      const torque = inertialTorque(record, rotation, {
        x: angularError.x * 600 - angularVelocity.x * 90,
        y: angularError.y * 600 - angularVelocity.y * 90,
        z: angularError.z * 600 - angularVelocity.z * 90,
      });
      this.physics.applyTorqueImpulse(
        hold.id,
        scaleVector(clampVector(torque, 1_200), dt),
      );
    }
  }

  private beamHubPortsAreAligned(beamId: string, hubId: string): boolean {
    const beam = this.physics.records.get(beamId);
    const hub = this.physics.records.get(hubId);
    const beamPosition = this.physics.bodyPosition(beamId);
    const hubPosition = this.physics.bodyPosition(hubId);
    const beamRotation = this.physics.bodyRotation(beamId);
    if (!beam || !hub || !beamPosition || !hubPosition || !beamRotation) return false;
    const beamAxisVector = rotateVector({ x: 0, y: 0, z: 1 }, beamRotation);
    const beamAxis = scaleVector(beamAxisVector, 1 / Math.max(.0001, vectorLength(beamAxisVector)));
    const nearSign = dot(subtract(hubPosition, beamPosition), beamAxis) >= 0 ? 1 : -1;
    const beamPort = add(beamPosition, scaleVector(beamAxis, nearSign * beam.size.z / 2));
    const hubDirectionVector = subtract(beamPosition, hubPosition);
    const hubDirection = scaleVector(
      hubDirectionVector,
      1 / Math.max(.0001, vectorLength(hubDirectionVector)),
    );
    const hubPort = add(
      hubPosition,
      scaleVector(hubDirection, hub.size.x / 2 + HUB_SOCKET_REACH),
    );
    return (
      distance3(beamPort, hubPort) < .03 &&
      Math.abs(dot(beamAxis, hubDirection)) > Math.cos(degrees(5))
    );
  }

  private beamPlankPortsAreAligned(beamId: string, plankId: string): boolean {
    const beam = this.physics.records.get(beamId);
    const plank = this.physics.records.get(plankId);
    const beamPosition = this.physics.bodyPosition(beamId);
    const plankPosition = this.physics.bodyPosition(plankId);
    const beamRotation = this.physics.bodyRotation(beamId);
    const plankRotation = this.physics.bodyRotation(plankId);
    if (!beam || !plank || !beamPosition || !plankPosition || !beamRotation || !plankRotation) {
      return false;
    }
    const beamAxis = normalize(rotateVector({ x: 0, y: 0, z: 1 }, beamRotation));
    const plankAxis = normalize(rotateVector({ x: 0, y: 0, z: 1 }, plankRotation));
    const beamSign = dot(subtract(plankPosition, beamPosition), beamAxis) >= 0 ? 1 : -1;
    const plankSign = dot(subtract(beamPosition, plankPosition), plankAxis) >= 0 ? 1 : -1;
    const beamPort = add(beamPosition, scaleVector(beamAxis, beamSign * beam.size.z / 2));
    const plankPort = add(plankPosition, scaleVector(plankAxis, plankSign * plank.size.z / 2));
    const endPortsReady = (
      distance3(beamPort, plankPort) < .03 &&
      Math.abs(dot(beamAxis, plankAxis)) > Math.cos(degrees(5)) &&
      Math.abs(beamPosition.y - plankPosition.y) < .03
    );
    const plankUp = normalize(rotateVector({ x: 0, y: 1, z: 0 }, plankRotation));
    const deckPosition = add(
      plankPosition,
      add(
        scaleVector(plankAxis, .35),
        scaleVector(plankUp, plank.size.y / 2 + .09 + beam.size.y / 2 + .005),
      ),
    );
    const deckPortsReady =
      distance3(beamPosition, deckPosition) < .03 &&
      Math.abs(dot(beamAxis, plankAxis)) > Math.cos(degrees(5));
    const ramPosition = add(
      plankPosition,
      add(
        scaleVector(plankAxis, RAM_SADDLE_FORWARD),
        scaleVector(plankUp, RAM_SADDLE_HEIGHT),
      ),
    );
    const ramRotation = multiplyQuaternion(plankRotation, xAxisQuat(RAM_SADDLE_PITCH));
    const ramPortsReady =
      distance3(beamPosition, ramPosition) < .03 &&
      vectorLength(quaternionAngularError(ramRotation, beamRotation)) < degrees(5);
    const postPosition = add(
      plankPosition,
      scaleVector(plankUp, plank.size.y / 2 + beam.size.z / 2 + .005),
    );
    const postPortsReady =
      distance3(beamPosition, postPosition) < .03 &&
      Math.abs(dot(beamAxis, plankUp)) > Math.cos(degrees(5));
    return endPortsReady || deckPortsReady || ramPortsReady || postPortsReady;
  }

  private axlePlankPortsAreAligned(axleId: string, plankId: string): boolean {
    const axle = this.physics.records.get(axleId);
    const plank = this.physics.records.get(plankId);
    const axlePosition = this.physics.bodyPosition(axleId);
    const plankPosition = this.physics.bodyPosition(plankId);
    const axleRotation = this.physics.bodyRotation(axleId);
    const plankRotation = this.physics.bodyRotation(plankId);
    if (!axle || !plank || !axlePosition || !plankPosition || !axleRotation || !plankRotation) {
      return false;
    }
    const plankLong = normalize(rotateVector({ x: 0, y: 0, z: 1 }, plankRotation));
    const plankCross = normalize(rotateVector({ x: 1, y: 0, z: 0 }, plankRotation));
    const axleAxis = normalize(rotateVector({ x: 0, y: 0, z: 1 }, axleRotation));
    const negativeBore = add(plankPosition, add(scaleVector(plankLong, -.5), { x: 0, y: -.12, z: 0 }));
    const positiveBore = add(plankPosition, add(scaleVector(plankLong, .5), { x: 0, y: -.12, z: 0 }));
    const nearestBore = distance3(axlePosition, negativeBore) <= distance3(axlePosition, positiveBore)
      ? negativeBore
      : positiveBore;
    return (
      distance3(axlePosition, nearestBore) < .03 &&
      Math.abs(dot(axleAxis, plankCross)) > Math.cos(degrees(5))
    );
  }

  private routeWorkers(
    active: ActiveAction,
    goals: Map<string, Vec3>,
    speed: number,
    dt: number,
    clearance: number,
    continuallyReplan = false,
    arrivalRadius = 0.22,
  ): boolean {
    let allArrived = true;
    const coordinatedCarry =
      ["carry", "assistCarry", "stage"].includes(active.request.action) &&
      Boolean(
        active.request.targetId &&
        this.carrying.get(active.request.targetId)?.actorIds.length &&
        (this.carrying.get(active.request.targetId)?.actorIds.length ?? 0) > 1,
      );
    if (coordinatedCarry && !continuallyReplan) {
      for (const [id, goal] of goals) {
        const position = this.physics.bodyPosition(id);
        if (position && !active.routes.has(id)) {
          active.routes.set(id, this.buildRoute(position, goal, clearance));
        }
      }
      let crewReachedWaypoint = true;
      while (crewReachedWaypoint) {
        const routedWorkers = [...goals.keys()].filter((id) => (active.routes.get(id)?.length ?? 0) > 0);
        crewReachedWaypoint = routedWorkers.length > 0 && routedWorkers.every((id) => {
          const position = this.physics.bodyPosition(id);
          const waypoint = active.routes.get(id)?.[0];
          return Boolean(position && waypoint && horizontalDistance(position, waypoint) < arrivalRadius);
        });
        if (crewReachedWaypoint) {
          for (const id of routedWorkers) active.routes.get(id)?.shift();
        }
      }
    }
    const coordinatedMoves: Array<{ workerId: string; desired: Vec3; facing: Vec3 }> = [];
    for (const [id, goal] of goals) {
      const worker = this.workers.get(id);
      const position = this.physics.bodyPosition(id);
      if (!worker || !position) continue;
      if (horizontalDistance(position, goal) < arrivalRadius) continue;
      allArrived = false;
      let route = active.routes.get(id);
      if (!route || continuallyReplan) {
        route = continuallyReplan ? [{ ...goal }] : this.buildRoute(position, goal, clearance);
        active.routes.set(id, route);
      }
      if (!coordinatedCarry) {
        while (route.length > 0 && horizontalDistance(position, route[0]!) < arrivalRadius) route.shift();
      }
      const waypoint = route[0] ?? goal;
      const dx = waypoint.x - position.x;
      const dz = waypoint.z - position.z;
      const distance = Math.max(0.0001, Math.hypot(dx, dz));
      const amount = Math.min(distance, speed * dt);
      const facing = { x: dx / distance, y: 0, z: dz / distance };
      if (coordinatedCarry) {
        coordinatedMoves.push({
          workerId: id,
          desired: { x: facing.x * amount, y: -.035, z: facing.z * amount },
          facing,
        });
        continue;
      }
      const result = this.physics.moveCharacter(
        id,
        { x: facing.x * amount, y: -0.035, z: facing.z * amount },
        facing,
      );
      if (result && Math.hypot(result.moved.x, result.moved.z) > 0.0001) worker.facing = facing;
    }
    if (coordinatedMoves.length > 0) {
      const results = this.physics.moveCharactersTogether(coordinatedMoves);
      for (const move of coordinatedMoves) {
        const worker = this.workers.get(move.workerId);
        const result = results.get(move.workerId);
        if (worker && result && Math.hypot(result.moved.x, result.moved.z) > .0001) {
          worker.facing = move.facing;
        }
      }
    }
    return allArrived;
  }

  private buildRoute(start: Vec3, end: Vec3, clearance: number): Vec3[] {
    if (clearance === 0 && Math.abs(end.x) > 6.05) {
      const aisleX = end.x < 0 ? -5.72 : 5.72;
      const directRackCorridorIsClear = this.rackCorridorIsClear(aisleX, end.x, end.z);
      if (!directRackCorridorIsClear) {
        const offsets = [
          -.65, .65, -.9, .9, -1, 1, -1.4, 1.4, -1.8, 1.8, -2.2, 2.2, -2.6, 2.6,
        ];
        const approachZ = offsets
          .map((offset) => end.z + offset)
          .filter((z) => z > -4.4 && z < 4.4)
          .find((z) => this.rackCorridorIsClear(aisleX, end.x, z));
        if (approachZ !== undefined) {
          return [
            { x: aisleX, y: .775, z: start.z },
            { x: aisleX, y: .775, z: approachZ },
            { x: end.x, y: .775, z: approachZ },
            { ...end, y: .775 },
          ];
        }
      }
      if (Math.abs(start.x) < 4) {
        // Clear any central assembly before turning toward an edge rack. A
        // centerward first step can pin a worker between a new machine and
        // the tower even though the outer aisle is open.
        const innerX = end.x < 0 ? -4.35 : 4.35;
        const bypassZ = end.z >= 0 ? 1.65 : -1.65;
        return [
          { x: innerX, y: .775, z: start.z },
          { x: innerX, y: .775, z: bypassZ },
          { x: aisleX, y: .775, z: bypassZ },
          { x: aisleX, y: .775, z: end.z },
          { ...end, y: .775 },
        ];
      }
      return [
        { x: aisleX, y: .775, z: start.z },
        { x: aisleX, y: .775, z: end.z },
        { ...end, y: .775 },
      ];
    }
    if (
      clearance === 0 &&
      start.x * end.x > 0 &&
      Math.min(Math.abs(start.x), Math.abs(end.x)) > 3 &&
      Math.abs(start.z - end.z) > 1.4
    ) {
      const aisleX = start.x < 0 ? -5.6 : 5.6;
      return [
        { x: aisleX, y: .775, z: start.z },
        { x: aisleX, y: .775, z: end.z },
        { ...end, y: .775 },
      ];
    }
    const towerRadius = 1.25 + clearance;
    const frontZ = Math.min(4.15, 2.0 + clearance);
    const backZ = Math.max(-4.55, -2.05 - clearance);
    const frontLength =
      horizontalDistance(start, { x: start.x, y: 0, z: frontZ }) +
      horizontalDistance({ x: start.x, y: 0, z: frontZ }, { x: end.x, y: 0, z: frontZ }) +
      horizontalDistance({ x: end.x, y: 0, z: frontZ }, end);
    const backLength =
      horizontalDistance(start, { x: start.x, y: 0, z: backZ }) +
      horizontalDistance({ x: start.x, y: 0, z: backZ }, { x: end.x, y: 0, z: backZ }) +
      horizontalDistance({ x: end.x, y: 0, z: backZ }, end);
    // A multi-worker load chooses one shared side of the tower. Independent
    // shortest paths would pull the two grips in opposite directions.
    const routeZ = clearance > 0
      ? end.z < -0.8 ? backZ : frontZ
      : frontLength <= backLength ? frontZ : backZ;
    if (clearance > 0) {
      const sameOuterLane =
        start.x * end.x > 0 &&
        Math.min(Math.abs(start.x), Math.abs(end.x)) > 4.5 &&
        Math.abs(start.x - end.x) < 1;
      if (sameOuterLane) {
        return [
          { x: end.x, y: .775, z: start.z },
          { x: end.x, y: .775, z: routeZ },
          { ...end, y: .775 },
        ];
      }
      const sideAisle = clearance > 1 ? 4.75 : 3.1;
      const clearX = start.x < 0
        ? Math.min(-sideAisle, start.x + clearance + .72)
        : Math.max(sideAisle, start.x - clearance - .72);
      let egressZ = start.z;
      const rackEgressPadding = Math.min(.55, Math.max(.38, clearance));
      if (
        Math.abs(start.x) > 6 &&
        !this.rackCorridorIsClear(start.x, clearX, start.z, rackEgressPadding)
      ) {
        const offsets = [-.65, .65, -1, 1, -1.4, 1.4, -1.8, 1.8, -2.2, 2.2];
        egressZ = offsets
          .map((offset) => start.z + offset)
          .filter((z) => z > -4.35 && z < 4.35)
          .find((z) => this.rackCorridorIsClear(start.x, clearX, z, rackEgressPadding)) ?? start.z;
      }
      return [
        { x: start.x, y: .775, z: egressZ },
        { x: clearX, y: .775, z: egressZ },
        { x: clearX, y: .775, z: routeZ },
        { x: end.x, y: .775, z: routeZ },
        { ...end, y: .775 },
      ];
    }
    if (!segmentNearOrigin(start, end, towerRadius)) return [{ ...end, y: .775 }];
    return [
      { x: start.x, y: .775, z: routeZ },
      { x: end.x, y: .775, z: routeZ },
      { ...end, y: .775 },
    ];
  }

  private rackCorridorIsClear(
    startX: number,
    endX: number,
    z: number,
    padding = .36,
  ): boolean {
    const minimumX = Math.min(startX, endX);
    const maximumX = Math.max(startX, endX);
    for (const record of this.physics.records.values()) {
      if (record.kind !== "part" || record.carriedBy) continue;
      const position = this.physics.bodyPosition(record.id);
      const rotation = this.physics.bodyRotation(record.id);
      if (!position || !rotation || position.x <= minimumX || position.x >= maximumX) continue;
      const halfDepth = projectedHalfExtent(record.size, rotation, "z");
      if (Math.abs(position.z - z) < halfDepth + padding) return false;
    }
    return true;
  }

  private workGoals(
    targetId: string,
    actorIds: string[],
    positionOverride?: Vec3,
    rotationOverride?: Quat,
  ): Map<string, Vec3> {
    const target = this.physics.records.get(targetId);
    const position = positionOverride ?? this.physics.bodyPosition(targetId) ?? { x: 0, y: 0, z: 0 };
    const rotation = rotationOverride ?? this.physics.bodyRotation(targetId) ?? { x: 0, y: 0, z: 0, w: 1 };
    if (target?.kind === "battle-machine") {
      const remoteReleasePost = target.id === "red-catch-sledge" || target.id === "green-battering-ram";
      return new Map(actorIds.map((id, index) => {
        const team = this.workers.get(id)?.team;
        const teamDirection = team === "king" ? -1 : 1;
        const formationIndex = (index - (actorIds.length - 1) / 2) * teamDirection;
        return [id, {
          x: remoteReleasePost
            ? (team === "king" ? -2.9 : 2.9) + formationIndex * .74
            : position.x + formationIndex * .74,
          y: .775,
          z: remoteReleasePost
            ? 4.05
            : Math.min(4.56, position.z + projectedHalfExtent(target.size, rotation, "z") + .58),
        }];
      }));
    }
    if (actorIds.length >= 2 && target?.kind === "part") {
      const halfLength = Math.max(target.size.x, target.size.z) / 2;
      // Stored long pieces sit between an outer rail and a parallel inner row.
      // Compact rack grips keep both capsules in the physical aisle instead of
      // sending the end worker into an adjacent inventory row.
      const reach = target.stored ? .55 : .82;
      const compactLongGrip = target.stored || target.family === "plank";
      const alongReach = compactLongGrip ? Math.min(.48, halfLength * .52) : halfLength + .28;
      const inward = target.team === "king" ? reach : target.team === "queen" ? -reach : 0;
      return new Map(actorIds.map((id, index) => {
        const along = actorIds.length === 1
          ? 0
          : index / (actorIds.length - 1) * 2 - 1;
        const local = target.size.z >= target.size.x
          ? { x: inward, y: 0, z: along * alongReach }
          : { x: along * alongReach, y: 0, z: inward };
        const offset = rotateVector(local, rotation);
        return [id, {
          x: position.x + offset.x,
          y: .775,
          z: Math.max(-3.42, Math.min(4.35, position.z + offset.z)),
        }];
      }));
    }
    return new Map(actorIds.map((id, index) => {
      const worker = this.workers.get(id);
      const side = target?.stored
        ? worker?.team === "king" ? 1 : -1
        : worker?.team === "king" ? -1 : 1;
      const sideExtent = target ? projectedHalfExtent(target.size, rotation, "x") : 0.1;
      return [id, {
        x: position.x + side * (sideExtent + .42 + index * .32),
        y: .775,
        z: target?.stored
          ? Math.max(-4.35, Math.min(4.35, position.z + (index - (actorIds.length - 1) / 2) * .36))
          : position.z + (index - (actorIds.length - 1) / 2) * .36,
      }];
    }));
  }

  private setCommandPostRoutes(active: ActiveAction): void {
    const team = this.workers.get(active.request.actorIds[0] ?? "")?.team ?? "king";
    const stagingX = team === "queen" ? 6.3 : -6.3;
    const battleCorridorZ = team === "queen" ? 4.1 : 4.65;
    const target = active.request.targetId ? this.physics.records.get(active.request.targetId) : undefined;
    for (const [id, goal] of active.workGoals ?? []) {
      const current = this.physics.bodyPosition(id) ?? goal;
      if (target?.kind === "battle-machine") {
        active.routes.set(id, [
          { x: current.x, y: .775, z: battleCorridorZ },
          { x: goal.x, y: .775, z: battleCorridorZ },
          goal,
        ]);
        continue;
      }
      active.routes.set(id, [
        { x: stagingX, y: .775, z: current.z },
        { x: stagingX, y: .775, z: -2.72 },
        { x: goal.x, y: .775, z: -2.72 },
        goal,
      ]);
    }
  }

  private workersNearGoals(active: ActiveAction, tolerance: number): boolean {
    return [...(active.workGoals ?? [])].every(([id, goal]) => {
      const position = this.physics.bodyPosition(id);
      return position ? distance3(position, goal) <= tolerance : false;
    });
  }

  private alignmentWorkGoals(
    targetId: string,
    actorIds: string[],
    position: Vec3,
    rotation: Quat,
  ): Map<string, Vec3> {
    const target = this.physics.records.get(targetId);
    if (!target || actorIds.length < 2) {
      return this.workGoals(targetId, actorIds, position, rotation);
    }
    const longLocal = target.size.x >= target.size.z
      ? { x: 1, y: 0, z: 0 }
      : { x: 0, y: 0, z: 1 };
    const longWorld = rotateVector(longLocal, rotation);
    const radialLength = Math.max(.01, Math.hypot(position.x, position.z));
    const firstTeam = this.workers.get(actorIds[0] ?? "")?.team;
    const away = radialLength > .7
      ? { x: position.x / radialLength, z: position.z / radialLength }
      : { x: firstTeam === "king" ? -1 : 1, z: 0 };
    return new Map(actorIds.map((id, index) => {
      const along = (index - (actorIds.length - 1) / 2) * .72;
      return [id, {
        x: position.x + away.x * .64 + longWorld.x * along,
        y: .775,
        z: position.z + away.z * .64 + longWorld.z * along,
      }];
    }));
  }

  private sideOnWorkGoals(
    targetId: string,
    actorIds: string[],
    position: Vec3,
    rotation: Quat,
  ): Map<string, Vec3> {
    const target = this.physics.records.get(targetId);
    if (!target || actorIds.length < 2) {
      return this.workGoals(targetId, actorIds, position, rotation);
    }
    const longLocal = target.size.x >= target.size.z
      ? { x: 1, y: 0, z: 0 }
      : { x: 0, y: 0, z: 1 };
    const longWorld = rotateVector(longLocal, rotation);
    const perpendicular = { x: -longWorld.z, z: longWorld.x };
    const currentSides = actorIds.map((id) => {
      const workerPosition = this.physics.bodyPosition(id) ?? position;
      return (workerPosition.x - position.x) * perpendicular.x +
        (workerPosition.z - position.z) * perpendicular.z;
    });
    const alreadyOpposed = currentSides.some((side) => side < -.05) &&
      currentSides.some((side) => side > .05);
    return new Map(actorIds.map((id, index) => {
      const workerPosition = this.physics.bodyPosition(id) ?? position;
      const workerOffset = {
        x: workerPosition.x - position.x,
        z: workerPosition.z - position.z,
      };
      const currentSide = workerOffset.x * perpendicular.x + workerOffset.z * perpendicular.z;
      const sideSign = alreadyOpposed && Math.abs(currentSide) > .05
        ? Math.sign(currentSide)
        : index === 0 ? -1 : 1;
      const side = { x: perpendicular.x * sideSign, z: perpendicular.z * sideSign };
      const along = (index - (actorIds.length - 1) / 2) * .46;
      return [id, {
        x: position.x + side.x * .92 + longWorld.x * along,
        y: .775,
        z: position.z + side.z * .92 + longWorld.z * along,
      }];
    }));
  }

  private frontSideWorkGoals(
    targetId: string,
    actorIds: string[],
    position: Vec3,
    rotation: Quat,
    sideOffset = .92,
  ): Map<string, Vec3> {
    const target = this.physics.records.get(targetId);
    if (!target || actorIds.length < 2) {
      return this.workGoals(targetId, actorIds, position, rotation);
    }
    const longLocal = target.size.x >= target.size.z
      ? { x: 1, y: 0, z: 0 }
      : { x: 0, y: 0, z: 1 };
    const longWorld = normalize(rotateVector(longLocal, rotation));
    return new Map(actorIds.map((id, index) => {
      const along = (index - (actorIds.length - 1) / 2) * .9;
      return [id, {
        x: position.x + longWorld.x * along,
        y: .775,
        z: position.z + sideOffset + longWorld.z * along,
      }];
    }));
  }

  private leverCarrySideGoals(
    targetId: string,
    actorIds: string[],
    position: Vec3,
    rotation: Quat,
  ): Map<string, Vec3> {
    const target = this.physics.records.get(targetId);
    if (!target || actorIds.length < 2) {
      return this.workGoals(targetId, actorIds, position, rotation);
    }
    const longWorld = normalize(rotateVector({ x: 0, y: 0, z: 1 }, rotation));
    const outward = { x: -longWorld.z, z: longWorld.x };
    return new Map(actorIds.map((id, index) => {
      const along = index === 0 ? -.72 : .72;
      return [id, {
        x: position.x + outward.x * .58 + longWorld.x * along,
        y: .775,
        z: position.z + outward.z * .58 + longWorld.z * along,
      }];
    }));
  }

  private fulcrumOutwardGoal(
    targetId: string,
    actorIds: string[],
    position: Vec3,
    rotation: Quat,
  ): Map<string, Vec3> {
    const target = this.physics.records.get(targetId);
    if (!target) return this.workGoals(targetId, actorIds, position, rotation);
    return new Map(actorIds.map((id) => [id, {
      x: position.x,
      y: .775,
      z: position.z - .58,
    }]));
  }

  private leverEffortGoals(
    targetId: string,
    actorIds: string[],
    position: Vec3,
    rotation: Quat,
  ): Map<string, Vec3> {
    const target = this.physics.records.get(targetId);
    if (!target || actorIds.length < 2) {
      return this.workGoals(targetId, actorIds, position, rotation);
    }
    const longWorld = normalize(rotateVector({ x: 0, y: 0, z: 1 }, rotation));
    const behindStroke = { x: longWorld.z, z: -longWorld.x };
    const effortEnd = {
      x: position.x - longWorld.x * .9,
      z: position.z - longWorld.z * .9,
    };
    return new Map(actorIds.map((id, index) => {
      const behindDistance = .58 + index * .8;
      return [id, {
        x: effortEnd.x + behindStroke.x * behindDistance,
        y: .775,
        z: effortEnd.z + behindStroke.z * behindDistance,
      }];
    }));
  }

  private endGripWorkGoals(
    targetId: string,
    actorIds: string[],
    position: Vec3,
    rotation: Quat,
  ): Map<string, Vec3> {
    const target = this.physics.records.get(targetId);
    if (!target || actorIds.length < 2) {
      return this.workGoals(targetId, actorIds, position, rotation);
    }
    const longLocal = target.size.x >= target.size.z
      ? { x: 1, y: 0, z: 0 }
      : { x: 0, y: 0, z: 1 };
    const longWorld = rotateVector(longLocal, rotation);
    const horizontal = normalize({ x: longWorld.x, y: 0, z: longWorld.z });
    const reach = Math.max(target.size.x, target.size.z) / 2 + .55;
    return new Map(actorIds.map((id, index) => {
      const along = actorIds.length === 1
        ? 0
        : index / (actorIds.length - 1) * 2 - 1;
      return [id, {
        x: position.x + horizontal.x * along * reach,
        y: .775,
        z: position.z + horizontal.z * along * reach,
      }];
    }));
  }

  private carryDestinationGoals(
    destination: Vec3,
    actorIds: string[],
    partId: string,
    orientation?: Quat,
  ): Map<string, Vec3> {
    const part = this.physics.records.get(partId);
    const rotation = orientation ?? this.physics.bodyRotation(partId) ?? { x: 0, y: 0, z: 0, w: 1 };
    const carryGroup = this.carrying.get(partId);
    if (actorIds.length >= 2 && part && carryGroup) {
      return new Map(actorIds.map((id) => {
        const joint = carryGroup.joints.find((candidate) => candidate.actorId === id);
        if (!joint) return [id, { ...destination, y: .775 }];
        const anchorOffset = rotateVector(joint.partAnchor, rotation);
        const handOffset = rotateVector(
          joint.handOffsetLocal ?? { x: 0, y: 0, z: 0 },
          rotation,
        );
        return [id, {
          x: destination.x + anchorOffset.x - handOffset.x,
          y: .775,
          z: destination.z + anchorOffset.z - handOffset.z,
        }];
      }));
    }
    if (actorIds.length >= 2 && part) {
      const team = this.workers.get(actorIds[0] ?? "")?.team;
      const lateral = team === "king" ? .55 : -.55;
      return new Map(actorIds.map((id, index) => {
        const sign = index === 0 ? -1 : 1;
        const local = part.size.z >= part.size.x
          ? { x: lateral, y: 0, z: sign * part.size.z * .39 }
          : { x: sign * part.size.x * .39, y: 0, z: lateral };
        const offset = rotateVector(local, rotation);
        return [id, { x: destination.x + offset.x, y: .775, z: destination.z + offset.z }];
      }));
    }
    const partPosition = this.physics.bodyPosition(partId) ?? destination;
    return new Map(actorIds.map((id, index) => {
      const workerPosition = this.physics.bodyPosition(id) ?? partPosition;
      const gripOffset = carryGroup?.gripTargetAngle !== undefined
        ? {
          x: Math.cos(carryGroup.gripTargetAngle) * .58,
          z: Math.sin(carryGroup.gripTargetAngle) * .58,
        }
        : {
          x: partPosition.x - workerPosition.x,
          z: partPosition.z - workerPosition.z,
        };
      return [id, {
        x: destination.x - gripOffset.x,
        y: .775,
        z: destination.z - gripOffset.z +
          (index - (actorIds.length - 1) / 2) * .35,
      }];
    }));
  }

  private attachCarry(
    partId: string,
    actorIds: string[],
    preserveCurrentGrips = false,
  ): CarryGroup | undefined {
    const part = this.physics.records.get(partId);
    const targetRotation = this.physics.bodyRotation(partId);
    if (!part || !targetRotation) return undefined;
    const joints: CarryJointRecord[] = [];
    for (let index = 0; index < actorIds.length; index += 1) {
      const actorId = actorIds[index];
      if (!actorId) continue;
      let partAnchor: Vec3 = { x: 0, y: 0, z: 0 };
      if (
        preserveCurrentGrips &&
        part.family !== "hub" &&
        part.family !== "wheel" &&
        part.family !== "sheave" &&
        part.family !== "drum" &&
        part.family !== "axle"
      ) {
        const workerPosition = this.physics.bodyPosition(actorId);
        const partPosition = this.physics.bodyPosition(partId);
        if (workerPosition && partPosition) {
          const localWorker = rotateVector(subtract(workerPosition, partPosition), {
            x: -targetRotation.x,
            y: -targetRotation.y,
            z: -targetRotation.z,
            w: targetRotation.w,
          });
          if (part.size.z >= part.size.x) {
            const gripLimit = part.family === "beam" ? .49 : .42;
            partAnchor = {
              x: 0,
              y: 0,
              z: Math.max(-part.size.z * gripLimit, Math.min(part.size.z * gripLimit, localWorker.z)),
            };
          } else {
            partAnchor = {
              x: Math.max(-part.size.x * .42, Math.min(part.size.x * .42, localWorker.x)),
              y: 0,
              z: 0,
            };
          }
        }
      } else if (actorIds.length >= 2) {
        const along = actorIds.length === 1
          ? 0
          : (index / (actorIds.length - 1) * 2 - 1) * .39;
        if (part.size.z >= part.size.x) partAnchor = { x: 0, y: 0, z: along * part.size.z };
        else partAnchor = { x: along * part.size.x, y: 0, z: 0 };
      }
      const workerPosition = this.physics.bodyPosition(actorId);
      const partPosition = this.physics.bodyPosition(partId);
      let handOffsetLocal: Vec3 | undefined;
      if (workerPosition && partPosition && actorIds.length >= 2) {
        const anchor = add(partPosition, rotateVector(partAnchor, targetRotation));
        const towardAnchor = subtract(anchor, workerPosition);
        const reach = Math.min(.58, vectorLength(towardAnchor));
        const handOffsetWorld = scaleVector(normalize(towardAnchor), reach);
        handOffsetLocal = rotateVector(handOffsetWorld, {
          x: -targetRotation.x,
          y: -targetRotation.y,
          z: -targetRotation.z,
          w: targetRotation.w,
        });
      }
      joints.push({
        actorId,
        partAnchor,
        ...(handOffsetLocal ? { handOffsetLocal } : {}),
        overstretchSeconds: 0,
      });
    }
    const group: CarryGroup = { partId, actorIds: [...actorIds], joints, targetRotation };
    if (actorIds.length === 1) {
      const worker = this.workers.get(actorIds[0] ?? "");
      const workerPosition = this.physics.bodyPosition(actorIds[0] ?? "");
      const partPosition = this.physics.bodyPosition(partId);
      if (worker && workerPosition && partPosition) {
        group.gripAngle = Math.atan2(
          partPosition.z - workerPosition.z,
          partPosition.x - workerPosition.x,
        );
        group.gripTargetAngle = worker.team === "king" ? 0 : Math.PI;
      }
    }
    return group;
  }

  private extendRamCarryReach(partId: string, group: CarryGroup): void {
    const partPosition = this.physics.bodyPosition(partId);
    const partRotation = this.physics.bodyRotation(partId);
    if (!partPosition || !partRotation) return;
    const inverseRotation = {
      x: -partRotation.x,
      y: -partRotation.y,
      z: -partRotation.z,
      w: partRotation.w,
    };
    group.extendedRamReach = true;
    for (const joint of group.joints) {
      const workerPosition = this.physics.bodyPosition(joint.actorId);
      if (!workerPosition) continue;
      const anchor = add(partPosition, rotateVector(joint.partAnchor, partRotation));
      const towardAnchor = subtract(anchor, workerPosition);
      const reach = 1.9;
      joint.handOffsetLocal = rotateVector(
        scaleVector(normalize(towardAnchor), reach),
        inverseRotation,
      );
    }
  }

  private updateCarryConstraints(dt: number): void {
    for (const [partId, group] of this.carrying) {
      const part = this.physics.records.get(partId);
      if (!part) continue;
      const partPosition = this.physics.bodyPosition(partId);
      const partRotation = this.physics.bodyRotation(partId);
      const linearVelocity = this.physics.bodyLinearVelocity(partId);
      const angularVelocity = this.physics.bodyAngularVelocity(partId);
      if (!partPosition || !partRotation || !linearVelocity || !angularVelocity) continue;
      const supportedMass = this.connectedMass(partId);
      let failed = false;
      if (group.gripAngle !== undefined && group.gripTargetAngle !== undefined) {
        const remaining = wrapAngle(group.gripTargetAngle - group.gripAngle);
        group.gripAngle += Math.sign(remaining) * Math.min(Math.abs(remaining), 1.35 * dt);
      }
      for (const record of group.joints) {
        const workerPosition = this.physics.bodyPosition(record.actorId);
        if (!workerPosition) continue;
        const partOffset = rotateVector(record.partAnchor, partRotation);
        const anchor = add(partPosition, partOffset);
        const dx = anchor.x - workerPosition.x;
        const dz = anchor.z - workerPosition.z;
        const horizontal = Math.max(.001, Math.hypot(dx, dz));
        const gripOffset = record.handOffsetLocal
          ? rotateVector(record.handOffsetLocal, partRotation)
          : group.actorIds.length === 1 && group.gripAngle !== undefined
          ? { x: Math.cos(group.gripAngle) * .58, z: Math.sin(group.gripAngle) * .58 }
          : { x: (dx / horizontal) * Math.min(.58, horizontal), z: (dz / horizontal) * Math.min(.58, horizontal) };
        const hand = {
          x: workerPosition.x + gripOffset.x,
          y: group.releaseHeight !== undefined
            ? group.releaseHeight + (record.heightOffset ?? 0)
            : workerPosition.y - .12,
          z: workerPosition.z + gripOffset.z,
        };
        const error = {
          x: hand.x - anchor.x,
          y: hand.y - anchor.y,
          z: hand.z - anchor.z,
        };
        const pointVelocity = add(linearVelocity, cross(angularVelocity, partOffset));
        const gripPositionGain = group.assemblyBrace ? 2_500 : part.family === "wedge" ? 1_800 : 760;
        const gripDamping = group.assemblyBrace ? 400 : part.family === "wedge" ? 180 : 105;
        const rawForce = {
          x: error.x * gripPositionGain - pointVelocity.x * gripDamping,
          y: error.y * gripPositionGain - pointVelocity.y * gripDamping +
            (group.supportsWeight === false ? 0 : 9.81 * supportedMass / group.joints.length),
          z: error.z * gripPositionGain - pointVelocity.z * gripDamping,
        };
        const forceLength = Math.max(.001, distance3(rawForce, { x: 0, y: 0, z: 0 }));
        const gripForceLimit = group.assemblyBrace
          ? 2_500
          : part.family === "wedge"
          ? 1_800
          : part.family === "wheel" || part.family === "hub" ||
              part.family === "sheave" || part.family === "drum" ? 1_200
            : (part.family === "beam" || part.family === "plank") && group.actorIds.length > 1
              ? 1_800
              : 720;
        const scale = Math.min(1, gripForceLimit / forceLength);
        if (!group.extendedRamReach) {
          this.physics.applyImpulseAtPoint(
            partId,
            {
              x: rawForce.x * scale * dt,
              y: rawForce.y * scale * dt,
              z: rawForce.z * scale * dt,
            },
            anchor,
          );
        }
        if (
          !group.extendedRamReach &&
          !group.assemblyBrace &&
          distance3(error, { x: 0, y: 0, z: 0 }) > 1.28
        ) {
          record.overstretchSeconds += dt;
        }
        else record.overstretchSeconds = Math.max(0, record.overstretchSeconds - dt * 2);
        if (!group.extendedRamReach && record.overstretchSeconds > .4) failed = true;
      }
      const angularError = quaternionAngularError(group.targetRotation, partRotation);
      const angularGain = group.assemblyBrace
        ? 120
        : part.family === "wedge"
        ? 20
        : part.family === "wheel" || part.family === "hub" || part.family === "sheave" ||
            part.family === "drum" || part.family === "axle" ? 70
          : (part.family === "beam" || part.family === "plank") && group.actorIds.length > 1 ? 40
            : 10;
      const angularDamping = group.assemblyBrace
        ? 30
        : part.family === "wedge"
        ? 8
        : part.family === "wheel" || part.family === "hub" || part.family === "sheave" ||
            part.family === "drum" || part.family === "axle" ? 18
          : (part.family === "beam" || part.family === "plank") && group.actorIds.length > 1 ? 12
            : 5;
      const desiredAngularAcceleration = {
        x: angularError.x * angularGain - angularVelocity.x * angularDamping,
        y: angularError.y * angularGain - angularVelocity.y * angularDamping,
        z: angularError.z * angularGain - angularVelocity.z * angularDamping,
      };
      const carryTorque = inertialTorque(part, partRotation, desiredAngularAcceleration);
      const torqueLimit = group.assemblyBrace
        ? 1_500
        : part.family === "wedge"
        ? 240
        : part.family === "wheel" || part.family === "hub" || part.family === "sheave" ||
            part.family === "drum" ? 120
          : part.family === "axle" ? 80
            : (part.family === "beam" || part.family === "plank") && group.actorIds.length > 1 ? 180
            : 18 * group.actorIds.length;
      this.physics.applyTorqueImpulse(
        partId,
        scaleVector(clampVector(carryTorque, torqueLimit), dt),
      );
      if (!failed) continue;
      this.physics.clearCarried(partId);
      this.carrying.delete(partId);
      this.emit({ text: `The ${plainObject(part)} strains free and drops.` });
      if (this.active?.request.targetId === partId) this.cancelActive("The carry constraint exceeded its safe load.");
    }
  }

  private connectedMass(rootId: string): number {
    const visited = new Set<string>();
    const pending = [rootId];
    let mass = 0;
    while (pending.length > 0) {
      const id = pending.pop();
      if (!id || visited.has(id)) continue;
      visited.add(id);
      const record = this.physics.records.get(id);
      if (record?.kind === "part") mass += approximateMass(record);
      for (const connection of this.connections) {
        if (connection.bodyA === id && !visited.has(connection.bodyB)) pending.push(connection.bodyB);
        if (connection.bodyB === id && !visited.has(connection.bodyA)) pending.push(connection.bodyA);
      }
    }
    return Math.max(0.1, mass);
  }

  private carryRadius(target: { size: Vec3 }): number {
    return Math.max(target.size.x, target.size.z) / 2 + .36;
  }

  private stepClearGoals(targetId: string, actorIds: string[]): Map<string, Vec3> {
    const partPosition = this.physics.bodyPosition(targetId) ?? { x: 0, y: 0, z: 0 };
    const target = this.physics.records.get(targetId);
    if (target?.family === "axle" && actorIds.length === 1) {
      return new Map(actorIds.map((id) => {
        const team = this.workers.get(id)?.team;
        return [id, { x: team === "queen" ? 5.6 : -5.6, y: .775, z: -4.12 }];
      }));
    }
    return new Map(actorIds.map((id, index) => {
      const workerPosition = this.physics.bodyPosition(id) ?? partPosition;
      const dx = workerPosition.x - partPosition.x;
      const dz = workerPosition.z - partPosition.z;
      const length = Math.max(0.01, Math.hypot(dx, dz));
      return [id, {
        x: workerPosition.x + (dx / length) * .7,
        y: .775,
        z: workerPosition.z + (dz / length) * .7 + (index === 0 ? -.12 : .12),
      }];
    }));
  }

  private foundationClearGoals(targetId: string, actorIds: string[]): Map<string, Vec3> {
    const position = this.physics.bodyPosition(targetId) ?? { x: 0, y: 0, z: 0 };
    return new Map(actorIds.map((id, index) => {
      const worker = this.physics.bodyPosition(id) ?? position;
      const dx = worker.x - position.x;
      const dz = worker.z - position.z;
      const length = Math.max(.01, Math.hypot(dx, dz));
      return [id, {
        x: worker.x + dx / length * .78 + (index === 0 ? -.08 : .08),
        y: .775,
        z: worker.z + dz / length * .78,
      }];
    }));
  }

  private pedestalFrontClearGoals(actorIds: string[]): Map<string, Vec3> {
    return new Map(actorIds.map((id) => {
      const worker = this.physics.bodyPosition(id) ?? { x: -2.2, y: .775, z: 1 };
      return [id, { x: worker.x, y: .775, z: worker.z + 1.15 }];
    }));
  }

  private pedestalLeftClearGoals(actorIds: string[]): Map<string, Vec3> {
    return new Map(actorIds.map((id, index) => {
      const worker = this.physics.bodyPosition(id) ?? { x: -2.2, y: .775, z: .7 };
      return [id, { x: -4.7 - index * .45, y: .775, z: worker.z }];
    }));
  }

  private hoistLoadClearGoals(targetId: string, actorIds: string[]): Map<string, Vec3> {
    const target = this.physics.records.get(targetId);
    const position = this.physics.bodyPosition(targetId) ?? { x: -5.6, y: .16, z: 1.5 };
    const endClearance = (target?.size.z ?? 1.8) / 2 + .7;
    return new Map(actorIds.map((id, index) => {
      const worker = this.physics.bodyPosition(id) ?? position;
      return [id, {
        x: worker.x,
        y: .775,
        z: position.z - endClearance - index * .35,
      }];
    }));
  }

  private beginReleaseClear(active: ActiveAction, targetId: string): void {
    active.phase = "clear";
    active.phaseElapsed = 0;
    active.routes.clear();
    this.physics.setPartWorkerCollisions(targetId, false);
    active.workGoals = active.request.targetPort === "foundation-clear"
      ? this.foundationClearGoals(targetId, active.request.actorIds)
      : active.request.targetPort === "pedestal-front-clear"
        ? this.pedestalFrontClearGoals(active.request.actorIds)
      : active.request.targetPort === "pedestal-left-clear"
          ? this.pedestalLeftClearGoals(active.request.actorIds)
          : active.request.targetPort === "plank-stage-clear"
            ? new Map(active.request.actorIds.map((id) => {
              const worker = this.physics.bodyPosition(id) ?? { x: -5.2, y: .775, z: 3.2 };
              return [id, { x: worker.x + .9, y: .775, z: worker.z }];
            }))
          : active.request.targetPort === "hoist-load-clear"
            ? this.hoistLoadClearGoals(targetId, active.request.actorIds)
          : active.request.targetPort === "hoist-rope-clear"
            ? new Map(active.request.actorIds.map((id) => [id, {
              x: -6.1,
              y: .775,
              z: .95,
            }]))
          : active.request.targetPort === "lever-fulcrum-clear"
            ? new Map(active.request.actorIds.map((id, index) => [id, {
              x: -2.85 - index * .35,
              y: .775,
              z: -3.65 - index * .3,
            }]))
          : active.request.targetPort === "lever-brace-clear"
            ? new Map(active.request.actorIds.map((id, index) => [id, {
              x: -1.85 - index * .3,
              y: .775,
              z: -.35 - index * .3,
            }]))
            : this.stepClearGoals(targetId, active.request.actorIds);
    if (active.request.targetPort === "lever-fulcrum-clear") {
      for (const [id, goal] of active.workGoals) {
        const start = this.physics.bodyPosition(id) ?? goal;
        active.routes.set(id, [
          { x: -2.55, y: .775, z: start.z },
          { x: -2.55, y: .775, z: goal.z },
          goal,
        ]);
      }
    } else if (active.request.targetPort === "hoist-load-clear") {
      const load = this.physics.records.get(targetId);
      const loadPosition = this.physics.bodyPosition(targetId);
      if (load && loadPosition) {
        const sideClearance = load.size.x / 2 + .68;
        for (const [id, goal] of active.workGoals) {
          const start = this.physics.bodyPosition(id) ?? goal;
          const sideDirection = start.x < loadPosition.x ? -1 : 1;
          const sideX = loadPosition.x + sideDirection * sideClearance;
          active.routes.set(id, [
            { x: sideX, y: .775, z: start.z },
            { x: sideX, y: .775, z: goal.z },
            goal,
          ]);
        }
      }
    } else if (active.request.targetPort === "hoist-rope-clear") {
      for (const [id, goal] of active.workGoals) active.routes.set(id, [goal]);
    }
    for (const id of active.request.actorIds) this.setWorkerPhase(id, "step-clear");
  }

  private reserveWorkPoses(active: ActiveAction): void {
    for (const id of active.request.actorIds) {
      const worker = this.workers.get(id);
      if (!worker) continue;
      worker.workPose = `${active.request.targetId ?? "stage"}:${id}`;
    }
  }

  private emitStart(request: LegalActionRequest): void {
    const actorId = request.actorIds[0];
    const actor = this.workers.get(actorId ?? "");
    const target = request.targetId ? this.physics.records.get(request.targetId) : undefined;
    let text = `${this.actorNames(request.actorIds)} begin ${actionLabel(request.action).toLowerCase()}.`;
    if (request.action === "reserve" && target) text = `${actor?.name ?? "A worker"} claims the ${plainObject(target)}.`;
    if ((request.action === "fetch" || request.action === "recover") && target) text = `${this.actorNames(request.actorIds)} head for the ${plainObject(target)}.`;
    if (request.action === "climb" && target) text = `${this.actorNames(request.actorIds)} approach the low end of the ${plainObject(target)}.`;
    if (["carry", "assistCarry", "stage"].includes(request.action) && target) text = `${this.actorNames(request.actorIds)} take positions around the ${plainObject(target)}.`;
    this.emit({ text, actorId, team: actor?.team });
  }

  private actorNames(ids: string[]): string {
    const names = ids.map((id) => this.workers.get(id)?.name ?? id);
    if (names.length <= 1) return names[0] ?? "A worker";
    return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  }

  private setWorkerPhase(id: string, phase: WorkerPhase): void {
    const worker = this.workers.get(id);
    if (worker) worker.phase = phase;
  }

  private complete(text: string, releaseWorkers = true): void {
    const active = this.requireActive();
    this.emit({
      text,
      actorId: active.request.actorIds[0],
      team: this.workers.get(active.request.actorIds[0] ?? "")?.team,
    });
    const targetId = active.request.targetId;
    const target = targetId ? this.physics.records.get(targetId) : undefined;
    const next = this.queue[0];
    const nextKeepsHandling = Boolean(
      targetId &&
      next?.targetId === targetId &&
      [
        "align", "turn", "carry", "assistCarry", "stage", "push", "pull",
        "hold", "release", "connect", "test",
      ].includes(next.action) &&
      next.actorIds.every((id) => active.request.actorIds.includes(id)),
    );
    if (targetId && target?.kind === "part" && target.carriedBy && !this.carrying.has(targetId) && !nextKeepsHandling) {
      this.physics.clearCarried(targetId);
    }
    if (releaseWorkers) this.resetWorkers(active.request.actorIds);
    else {
      for (const id of active.request.actorIds) {
        const worker = this.workers.get(id);
        if (worker) {
          worker.phase = "holding";
          worker.action = undefined;
          worker.workPose = undefined;
        }
      }
    }
    this.active = undefined;
  }

  private cancelActive(text: string, emitEvent = true): void {
    if (!this.active) return;
    const request = this.active.request;
    if (this.active.inProgressConnectionId) {
      this.physics.removeAssemblyJoint(this.active.inProgressConnectionId);
    }
    if (emitEvent) {
      this.emit({ text, actorId: request.actorIds[0], team: this.workers.get(request.actorIds[0] ?? "")?.team });
    }
    if (request.targetId && this.carrying.has(request.targetId)) {
      this.carrying.delete(request.targetId);
      this.physics.clearCarried(request.targetId);
      this.clearConnectedWheelsetCarried(request.targetId);
      if (emitEvent) this.emit({ text: "The workers release the load when the sequence stops." });
    } else if (request.targetId && this.physics.records.get(request.targetId)?.carriedBy) {
      this.physics.clearCarried(request.targetId);
    }
    this.queue.length = 0;
    this.resetWorkers(request.actorIds);
    this.active = undefined;
  }

  private setConnectedWheelsetCarried(axleId: string, actorIds: string[]): void {
    if (this.physics.records.get(axleId)?.family !== "axle") return;
    for (const connection of this.connections) {
      if (connection.class !== "KEYED_COAXIAL") continue;
      const connectedId = connection.bodyA === axleId
        ? connection.bodyB
        : connection.bodyB === axleId ? connection.bodyA : undefined;
      if (connectedId) this.physics.setCarried(connectedId, actorIds, false);
    }
  }

  private clearConnectedWheelsetCarried(axleId: string): void {
    if (this.physics.records.get(axleId)?.family !== "axle") return;
    for (const connection of this.connections) {
      if (connection.class !== "KEYED_COAXIAL") continue;
      const connectedId = connection.bodyA === axleId
        ? connection.bodyB
        : connection.bodyB === axleId ? connection.bodyA : undefined;
      if (connectedId) this.physics.clearCarried(connectedId);
    }
  }

  private resetWorkers(ids: string[]): void {
    for (const id of ids) {
      this.physics.setCharacterPushesBodies(id, false);
      const worker = this.workers.get(id);
      if (!worker) continue;
      worker.phase = "idle";
      worker.action = undefined;
      worker.targetId = undefined;
      worker.destination = undefined;
      worker.workPose = undefined;
    }
  }

  private guardTimeout(seconds: number): void {
    if ((this.active?.totalElapsed ?? 0) > seconds) this.cancelActive("The route is blocked; the workers stop rather than pass through it.");
  }

  private requireActive(): ActiveAction {
    if (!this.active) throw new Error("No active action");
    return this.active;
  }
}

function cloneRequest(request: LegalActionRequest): LegalActionRequest {
  const clone: LegalActionRequest = {
    action: request.action,
    actorIds: [...request.actorIds],
  };
  if (request.targetId) clone.targetId = request.targetId;
  if (request.secondaryId) clone.secondaryId = request.secondaryId;
  if (request.destination) clone.destination = { ...request.destination };
  if (request.orientation) clone.orientation = { ...request.orientation };
  if (request.targetPort) clone.targetPort = request.targetPort;
  if (request.secondaryPort) clone.secondaryPort = request.secondaryPort;
  if (request.connectionClass) clone.connectionClass = request.connectionClass;
  if (request.magnitude !== undefined) clone.magnitude = request.magnitude;
  if (request.loadId) clone.loadId = request.loadId;
  if (request.loadTravel !== undefined) clone.loadTravel = request.loadTravel;
  return clone;
}

function connectionCompletionText(
  connectionClass: ConnectionClass,
  actors: string,
  joinedObject: string,
): string {
  if (connectionClass === "TENON_LOCK") {
    return `${actors} drive the tenon home and pin the timber lock.`;
  }
  if (connectionClass === "AXLE_BEARING") {
    return `${actors} seat the axle in the ${joinedObject} bearing and leave it free to turn.`;
  }
  if (connectionClass === "KEYED_COAXIAL") {
    return `${actors} key the ${joinedObject} to the axle so both turn together.`;
  }
  return `${actors} secure the rope to the ${joinedObject} with visible slack remaining.`;
}

function connectionId(
  connectionClass: ConnectionClass,
  firstId: string,
  secondId: string,
): string {
  return `connection:${connectionClass.toLowerCase()}:${[firstId, secondId].sort().join(":")}`;
}

function plainObject(record: { family?: string; kind: string; variant?: string }): string {
  if (record.family === "wheel") return "spoked wheel";
  if (record.family === "sheave") return "deep-groove sheave";
  if (record.family === "drum") return "winding drum";
  if (record.family === "beam") {
    if (record.variant?.startsWith("long-")) return "long beam";
    if (record.variant?.startsWith("medium-")) return "medium beam";
    return "short beam";
  }
  if (record.family === "plank") return "broad plank";
  if (record.family === "rope") return "coiled rope";
  if (record.family) return record.family;
  if (record.kind === "tower-block") return "tower timber";
  if (record.kind === "cradle") return "cradle";
  if (record.kind === "queen-device") return "Queen's command post";
  if (record.kind === "queen-bolt") return "crown bolt";
  return "object";
}

function actionLabel(action: string): string {
  return action.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase());
}

function isRamOpenSide(port: string | undefined): boolean {
  return port === "ram-west-side" || port === "ram-open-side";
}

function horizontalDistance(first: Vec3, second: Vec3): number {
  return Math.hypot(first.x - second.x, first.z - second.z);
}

function distance3(first: Vec3, second: Vec3): number {
  return Math.hypot(first.x - second.x, first.y - second.y, first.z - second.z);
}

function smoothStep(value: number): number {
  const clamped = Math.max(0, Math.min(1, value));
  return clamped * clamped * (3 - 2 * clamped);
}

function segmentNearOrigin(start: Vec3, end: Vec3, radius: number): boolean {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const denominator = dx * dx + dz * dz;
  const t = denominator <= 0.0001 ? 0 : Math.max(0, Math.min(1, -(start.x * dx + start.z * dz) / denominator));
  const nearestX = start.x + dx * t;
  const nearestZ = start.z + dz * t;
  return Math.hypot(nearestX, nearestZ) < radius;
}

function rotateVector(vector: Vec3, rotation: { x: number; y: number; z: number; w: number }): Vec3 {
  const tx = 2 * (rotation.y * vector.z - rotation.z * vector.y);
  const ty = 2 * (rotation.z * vector.x - rotation.x * vector.z);
  const tz = 2 * (rotation.x * vector.y - rotation.y * vector.x);
  return {
    x: vector.x + rotation.w * tx + (rotation.y * tz - rotation.z * ty),
    y: vector.y + rotation.w * ty + (rotation.z * tx - rotation.x * tz),
    z: vector.z + rotation.w * tz + (rotation.x * ty - rotation.y * tx),
  };
}

function projectedHalfExtent(size: Vec3, rotation: Quat, axis: "x" | "z"): number {
  const localAxes = [
    rotateVector({ x: size.x / 2, y: 0, z: 0 }, rotation),
    rotateVector({ x: 0, y: size.y / 2, z: 0 }, rotation),
    rotateVector({ x: 0, y: 0, z: size.z / 2 }, rotation),
  ];
  return localAxes.reduce((extent, vector) => extent + Math.abs(vector[axis]), 0);
}

function partEndLocal(size: Vec3, sign: 1 | -1): Vec3 {
  if (size.x >= size.y && size.x >= size.z) return { x: sign * size.x * .46, y: 0, z: 0 };
  if (size.y >= size.x && size.y >= size.z) return { x: 0, y: sign * size.y * .46, z: 0 };
  return { x: 0, y: 0, z: sign * size.z * .46 };
}

function add(first: Vec3, second: Vec3): Vec3 {
  return { x: first.x + second.x, y: first.y + second.y, z: first.z + second.z };
}

function subtract(first: Vec3, second: Vec3): Vec3 {
  return { x: first.x - second.x, y: first.y - second.y, z: first.z - second.z };
}

function scaleVector(vector: Vec3, scalar: number): Vec3 {
  return { x: vector.x * scalar, y: vector.y * scalar, z: vector.z * scalar };
}

function normalize(vector: Vec3): Vec3 {
  const length = vectorLength(vector);
  return length > .0001 ? scaleVector(vector, 1 / length) : { x: 0, y: 0, z: 1 };
}

function vectorLength(vector: Vec3): number {
  return Math.hypot(vector.x, vector.y, vector.z);
}

function clampVector(vector: Vec3, maximum: number): Vec3 {
  const length = vectorLength(vector);
  return length > maximum && length > 0 ? scaleVector(vector, maximum / length) : vector;
}

function approximateMass(record: { family?: string; kind: string; variant?: string }): number {
  if (record.kind === "tower-block") return 92;
  if (record.family === "beam") {
    if (record.variant?.startsWith("long-")) return 31;
    if (record.variant?.startsWith("medium-")) return 21;
    return 12;
  }
  if (record.family === "plank") return 28;
  if (record.family === "hub") return 22;
  if (record.family === "wheel") return 25;
  if (record.family === "sheave") return 14;
  if (record.family === "drum") return 23;
  if (record.family === "axle") return record.variant?.startsWith("long-") ? 29 : 18;
  if (record.family === "wedge") return 11;
  if (record.family === "rope") return 8;
  return 20;
}

function inertialTorque(
  record: { size: Vec3; family?: string; kind: string; variant?: string },
  rotation: Quat,
  angularAcceleration: Vec3,
): Vec3 {
  const mass = approximateMass(record);
  const localAcceleration = rotateVector(angularAcceleration, {
    x: -rotation.x,
    y: -rotation.y,
    z: -rotation.z,
    w: rotation.w,
  });
  const inertia = {
    x: mass * (record.size.y ** 2 + record.size.z ** 2) / 12,
    y: mass * (record.size.x ** 2 + record.size.z ** 2) / 12,
    z: mass * (record.size.x ** 2 + record.size.y ** 2) / 12,
  };
  return rotateVector({
    x: localAcceleration.x * inertia.x,
    y: localAcceleration.y * inertia.y,
    z: localAcceleration.z * inertia.z,
  }, rotation);
}

function quaternionAngularError(target: Quat, current: Quat): Vec3 {
  let error = multiplyQuaternion(target, {
    x: -current.x,
    y: -current.y,
    z: -current.z,
    w: current.w,
  });
  if (error.w < 0) error = { x: -error.x, y: -error.y, z: -error.z, w: -error.w };
  const vectorMagnitude = Math.hypot(error.x, error.y, error.z);
  if (vectorMagnitude < 0.000001) return { x: 0, y: 0, z: 0 };
  const angle = 2 * Math.atan2(vectorMagnitude, Math.max(0, error.w));
  return {
    x: (error.x / vectorMagnitude) * angle,
    y: (error.y / vectorMagnitude) * angle,
    z: (error.z / vectorMagnitude) * angle,
  };
}

function multiplyQuaternion(left: Quat, right: Quat): Quat {
  return {
    w: left.w * right.w - left.x * right.x - left.y * right.y - left.z * right.z,
    x: left.w * right.x + left.x * right.w + left.y * right.z - left.z * right.y,
    y: left.w * right.y - left.x * right.z + left.y * right.w + left.z * right.x,
    z: left.w * right.z + left.x * right.y - left.y * right.x + left.z * right.w,
  };
}

function quatFromLocalZ(axis: Vec3): Quat {
  const yaw = Math.atan2(axis.x, axis.z);
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}

function xAxisQuat(angle: number): Quat {
  return { x: Math.sin(angle / 2), y: 0, z: 0, w: Math.cos(angle / 2) };
}

function degrees(value: number): number {
  return (value * Math.PI) / 180;
}

function wrapAngle(value: number): number {
  let wrapped = value;
  while (wrapped > Math.PI) wrapped -= Math.PI * 2;
  while (wrapped < -Math.PI) wrapped += Math.PI * 2;
  return wrapped;
}

function cross(first: Vec3, second: Vec3): Vec3 {
  return {
    x: first.y * second.z - first.z * second.y,
    y: first.z * second.x - first.x * second.z,
    z: first.x * second.y - first.y * second.x,
  };
}

function dot(first: Vec3, second: Vec3): number {
  return first.x * second.x + first.y * second.y + first.z * second.z;
}
