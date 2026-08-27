# Website function refactoring plan

[Back to plan index](./index.md)

This file assigns an explicit action to all 30 measured website production functions.

| ID | Function | State | CC | Coverage | CRAP | Mutation gaps S/NC | Priority / wave | Action | Acceptance |
|---|---|---|---:|---:|---:|---:|---|---|---|
| RF-0112 | `website/app.js:163 <anonymous@163:40>` | warn | 4 | 0% | 20 | 0/0 | P3 / W4 | test-and-simplify | Changed branch coverage >=80%; extracted functions CC <=30 and CRAP <30; no mutation regression. |
| RF-0120 | `website/demo/src/deck.js:62 <anonymous@62:44>` | pass | 14 | 70.83% | 18.86 | 15/2 | P4 / W5 | test-hardening-when-touched | Changed branch coverage >=80%; extracted functions CC <=30 and CRAP <30; no mutation regression. |
| RF-0217 | `website/app.js:1 <anonymous@1:2>` | pass | 3 | 0% | 12 | 0/0 | P4 / W5 | test-hardening-when-touched | Changed branch coverage >=80%; extracted functions CC <=30 and CRAP <30; no mutation regression. |
| RF-0335 | `website/app.js:17 <anonymous@17:25>` | pass | 2 | 0% | 6 | 0/0 | P4 / W5 | test-hardening-when-touched | Changed branch coverage >=80%; extracted functions CC <=30 and CRAP <30; no mutation regression. |
| RF-0336 | `website/app.js:129 <anonymous@129:43>` | pass | 2 | 0% | 6 | 0/0 | P4 / W5 | test-hardening-when-touched | Changed branch coverage >=80%; extracted functions CC <=30 and CRAP <30; no mutation regression. |
| RF-0351 | `website/demo/src/deck.js:30 go` | pass | 4 | 66.67% | 4.59 | 13/0 | P4 / W5 | test-hardening-when-touched | Changed branch coverage >=80%; extracted functions CC <=30 and CRAP <30; no mutation regression. |
| RF-0443 | `website/demo/src/deck.js:21 <anonymous@21:25>` | pass | 2 | 70.83% | 2.1 | 9/0 | P4 / W5 | test-hardening-when-touched | Changed branch coverage >=80%; extracted functions CC <=30 and CRAP <30; no mutation regression. |
| RF-0444 | `website/demo/src/deck.js:102 <anonymous@102:39>` | pass | 2 | 70.83% | 2.1 | 1/0 | P4 / W5 | test-hardening-when-touched | Changed branch coverage >=80%; extracted functions CC <=30 and CRAP <30; no mutation regression. |
| RF-0728 | `website/app.js:7 updateNav` | pass | 1 | 0% | 2 | 0/0 | P4 / W5 | test-hardening-when-touched | Changed branch coverage >=80%; extracted functions CC <=30 and CRAP <30; no mutation regression. |
| RF-0729 | `website/app.js:16 <anonymous@16:7>` | pass | 1 | 0% | 2 | 0/0 | P4 / W5 | test-hardening-when-touched | Changed branch coverage >=80%; extracted functions CC <=30 and CRAP <30; no mutation regression. |
| RF-0730 | `website/app.js:26 <anonymous@26:21>` | pass | 1 | 0% | 2 | 0/0 | P4 / W5 | test-hardening-when-touched | Changed branch coverage >=80%; extracted functions CC <=30 and CRAP <30; no mutation regression. |
| RF-0731 | `website/app.js:30 <anonymous@30:21>` | pass | 1 | 0% | 2 | 0/0 | P4 / W5 | test-hardening-when-touched | Changed branch coverage >=80%; extracted functions CC <=30 and CRAP <30; no mutation regression. |
| RF-0732 | `website/app.js:112 <anonymous@112:23>` | pass | 1 | 0% | 2 | 0/0 | P4 / W5 | test-hardening-when-touched | Changed branch coverage >=80%; extracted functions CC <=30 and CRAP <30; no mutation regression. |
| RF-0733 | `website/app.js:113 <anonymous@113:35>` | pass | 1 | 0% | 2 | 0/0 | P4 / W5 | test-hardening-when-touched | Changed branch coverage >=80%; extracted functions CC <=30 and CRAP <30; no mutation regression. |
| RF-0734 | `website/app.js:115 <anonymous@115:27>` | pass | 1 | 0% | 2 | 0/0 | P4 / W5 | test-hardening-when-touched | Changed branch coverage >=80%; extracted functions CC <=30 and CRAP <30; no mutation regression. |
| RF-0735 | `website/app.js:151 <anonymous@151:23>` | pass | 1 | 0% | 2 | 0/0 | P4 / W5 | test-hardening-when-touched | Changed branch coverage >=80%; extracted functions CC <=30 and CRAP <30; no mutation regression. |
| RF-0736 | `website/app.js:152 <anonymous@152:35>` | pass | 1 | 0% | 2 | 0/0 | P4 / W5 | test-hardening-when-touched | Changed branch coverage >=80%; extracted functions CC <=30 and CRAP <30; no mutation regression. |
| RF-0737 | `website/app.js:153 <anonymous@153:27>` | pass | 1 | 0% | 2 | 0/0 | P4 / W5 | test-hardening-when-touched | Changed branch coverage >=80%; extracted functions CC <=30 and CRAP <30; no mutation regression. |
| RF-0738 | `website/app.js:165 <anonymous@165:18>` | pass | 1 | 0% | 2 | 0/0 | P4 / W5 | test-hardening-when-touched | Changed branch coverage >=80%; extracted functions CC <=30 and CRAP <30; no mutation regression. |
| RF-0739 | `website/app.js:168 <anonymous@168:25>` | pass | 1 | 0% | 2 | 0/0 | P4 / W5 | test-hardening-when-touched | Changed branch coverage >=80%; extracted functions CC <=30 and CRAP <30; no mutation regression. |
| RF-0740 | `website/demo/src/main.js:3 <anonymous@3:50>` | pass | 1 | 0% | 2 | 0/0 | P4 / W5 | test-hardening-when-touched | Changed branch coverage >=80%; extracted functions CC <=30 and CRAP <30; no mutation regression. |
| RF-0741 | `website/demo/src/main.js:6 <anonymous@6:71>` | pass | 1 | 0% | 2 | 0/0 | P4 / W5 | test-hardening-when-touched | Changed branch coverage >=80%; extracted functions CC <=30 and CRAP <30; no mutation regression. |
| RF-0839 | `website/demo/src/deck.js:36 <anonymous@36:19>` | pass | 1 | 66.67% | 1.04 | 2/0 | P4 / W5 | test-hardening-when-touched | Changed branch coverage >=80%; extracted functions CC <=30 and CRAP <30; no mutation regression. |
| RF-0844 | `website/demo/src/deck.js:3 initDeck` | pass | 1 | 70.83% | 1.02 | 47/2 | P4 / W5 | test-hardening-when-touched | Changed branch coverage >=80%; extracted functions CC <=30 and CRAP <30; no mutation regression. |
| RF-0845 | `website/demo/src/deck.js:26 <anonymous@26:38>` | pass | 1 | 70.83% | 1.02 | 0/0 | P4 / W5 | test-hardening-when-touched | Changed branch coverage >=80%; extracted functions CC <=30 and CRAP <30; no mutation regression. |
| RF-0846 | `website/demo/src/deck.js:59 <anonymous@59:38>` | pass | 1 | 70.83% | 1.02 | 3/0 | P4 / W5 | test-hardening-when-touched | Changed branch coverage >=80%; extracted functions CC <=30 and CRAP <30; no mutation regression. |
| RF-0847 | `website/demo/src/deck.js:60 <anonymous@60:38>` | pass | 1 | 70.83% | 1.02 | 0/0 | P4 / W5 | test-hardening-when-touched | Changed branch coverage >=80%; extracted functions CC <=30 and CRAP <30; no mutation regression. |
| RF-0848 | `website/demo/src/deck.js:101 <anonymous@101:43>` | pass | 1 | 70.83% | 1.02 | 0/0 | P4 / W5 | test-hardening-when-touched | Changed branch coverage >=80%; extracted functions CC <=30 and CRAP <30; no mutation regression. |
| RF-3422 | `website/demo/src/deck.js:48 update` | pass | 1 | 100% | 1 | 6/0 | P5 / continuous | preserve | Keep CRAP <20, retain coverage floor, and introduce no mutation regression. |
| RF-3423 | `website/demo/src/deck.js:54 <anonymous@54:47>` | pass | 1 | 100% | 1 | 5/0 | P5 / continuous | preserve | Keep CRAP <20, retain coverage floor, and introduce no mutation regression. |
