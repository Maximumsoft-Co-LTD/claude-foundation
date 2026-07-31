# Plan: Spike — queue comparison

**Type**: spike

## Summary

A timeboxed exploration: prototype a trivial job in each library and compare ergonomics and operations.

## Architecture diagram

```mermaid
flowchart LR
  Notif[Notifications service] --> Queue[Queue library under test]
  Queue --> Worker[Worker process]
```

## Exploration plan

1. Stand up a minimal producer and worker in each library.
2. Compare the retry, dead-letter, and observability stories.
3. Write the recommendation with the reasoning.
