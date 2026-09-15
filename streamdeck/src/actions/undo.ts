import { action, SingletonAction } from "@elgato/streamdeck";

@action({ UUID: "com.scrthq.runlog.undo" })
export class Undo extends SingletonAction {}
