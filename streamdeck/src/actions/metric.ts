import { action, SingletonAction } from "@elgato/streamdeck";

@action({ UUID: "com.scrthq.runlog.metric" })
export class Metric extends SingletonAction {}
