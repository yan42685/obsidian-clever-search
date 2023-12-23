import { jest } from "@jest/globals";
import { EventEnum } from "src/globals/event-enum";
import { EventBus } from "src/utils/event-bus";


describe('EventBus', () => {
  let eventBus: EventBus;

  beforeEach(() => {
    eventBus = new EventBus();
  });

  it('should register and trigger an event', () => {
    const mockCallback = jest.fn();
    eventBus.on(EventEnum.TEST_EVENT_A, mockCallback);

    eventBus.emit(EventEnum.TEST_EVENT_A, 'arg1', 'arg2');
    expect(mockCallback).toHaveBeenCalledWith('arg1', 'arg2');
  });

  it('should not trigger callback after being removed', () => {
    const mockCallback = jest.fn();
    eventBus.on(EventEnum.TEST_EVENT_A, mockCallback);
    eventBus.off(EventEnum.TEST_EVENT_A, mockCallback);

    eventBus.emit(EventEnum.TEST_EVENT_A, 'arg1', 'arg2');
    expect(mockCallback).not.toHaveBeenCalled();
  });

  it('should handle multiple callbacks for a single event', () => {
    const mockCallback1 = jest.fn();
    const mockCallback2 = jest.fn();

    eventBus.on(EventEnum.TEST_EVENT_A, mockCallback1);
    eventBus.on(EventEnum.TEST_EVENT_A, mockCallback2);

    eventBus.emit(EventEnum.TEST_EVENT_A, 'arg1', 'arg2');
    expect(mockCallback1).toHaveBeenCalledWith('arg1', 'arg2');
    expect(mockCallback2).toHaveBeenCalledWith('arg1', 'arg2');
  });

  it('should not affect other events when removing a callback', () => {
    const mockCallback1 = jest.fn();
    const mockCallback2 = jest.fn();

    eventBus.on(EventEnum.TEST_EVENT_A, mockCallback1);
    eventBus.on(EventEnum.TEST_EVENT_B, mockCallback2);
    eventBus.off(EventEnum.TEST_EVENT_A, mockCallback1);

    eventBus.emit(EventEnum.TEST_EVENT_A, 'arg1');
    eventBus.emit(EventEnum.TEST_EVENT_B, 'arg2');
    
    expect(mockCallback1).not.toHaveBeenCalled();
    expect(mockCallback2).toHaveBeenCalledWith('arg2');
  });
});
