import { action, SingletonAction } from "@elgato/streamdeck";

@action({ UUID: "com.scrthq.runlog.run" })
export class Run extends SingletonAction {}
