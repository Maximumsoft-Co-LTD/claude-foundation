# Website function refactoring plan

[Back to plan index](./index.md)

This file assigns an explicit action to all 30 measured website production functions.

| ID | Function | State | CC | Coverage | CRAP | Mutation gaps S/NC | Priority / wave | Action | Acceptance |
|---|---|---|---:|---:|---:|---:|---|---|---|
| RF-0143 | `website/app.js:163 <anonymous@163:40>` | warn | 4 | 0% | 20 | 0/0 | P3 / W4 | test-and-simplify | Changed branch coverage >=80%; extracted functions CC <=30 and CRAP <30; no mutation regression. |
| RF-0150 | `website/demo/src/deck.js:62 <anonymous@62:44>` | pass | 14 | 70.83% | 18.86 | 15/2 | P4 / W5 | test-hardening-when-touched | Changed branch coverage >=80%; extracted functions CC <=30 and CRAP <30; no mutation regression. |
| RF-0252 | `website/app.js:1 <anonymous@1:2>` | pass | 3 | 0% | 12 | 0/0 | P4 / W5 | test-hardening-when-touched | Changed branch coverage >=80%; extracted functions CC <=30 and CRAP <30; no mutation regression. |
| RF-0379 | `website/app.js:17 <anonymous@17:25>` | pass | 2 | 0% | 6 | 0/0 | P4 / W5 | test-hardening-when-touched | Changed branch coverage >=80%; extracted functions CC <=30 and CRAP <30; no mutation regression. |
| RF-0380 | `website/app.js:129 <anonymous@129:43>` | pass | 2 | 0% | 6 | 0/0 | P4 / W5 | test-hardening-when-touched | Changed branch coverage >=80%; extracted functions CC <=30 and CRAP <30; no mutation regression. |
| RF-0395 | `website/demo/src/deck.js:30 go` | pass | 4 | 66.67% | 4.59 | 13/0 | P4 / W5 | test-hardening-when-touched | Changed branch coverage >=80%; extracted functions CC <=30 and CRAP <30; no mutation regression. |
| RF-0495 | `website/demo/src/deck.js:21 <anonymous@21:25>` | pass | 2 | 70.83% | 2.1 | 9/0 | P4 / W5 | test-hardening-when-touched | Changed branch coverage >=80%; extracted functions CC <=30 and CRAP <30; no mutation regression. |
| RF-0496 | `website/demo/src/deck.js:102 <anonymous@102:39>` | pass | 2 | 70.83% | 2.1 | 1/0 | P4 / W5 | test-hardening-when-touched | Changed branch coverage >=80%; extracted functions CC <=30 and CRAP <30; no mutation regression. |
| RF-0794 | `website/app.js:7 updateNav` | pass | 1 | 0% | 2 | 0/0 | P4 / W5 | test-hardening-when-touched | Changed branch coverage >=80%; extracted functions CC <=30 and CRAP <30; no mutation regression. |
| RF-0795 | `website/app.js:16 <anonymous@16:7>` | pass | 1 | 0% | 2 | 0/0 | P4 / W5 | test-hardening-when-touched | Changed branch coverage >=80%; extracted functions CC <=30 and CRAP <30; no mutation regression. |
| RF-0796 | `website/app.js:26 <anonymous@26:21>` | pass | 1 | 0% | 2 | 0/0 | P4 / W5 | test-hardening-when-touched | Changed branch coverage >=80%; extracted functions CC <=30 and CRAP <30; no mutation regression. |
| RF-0797 | `website/app.js:30 <anonymous@30:21>` | pass | 1 | 0% | 2 | 0/0 | P4 / W5 | test-hardening-when-touched | Changed branch coverage >=80%; extracted functions CC <=30 and CRAP <30; no mutation regression. |
| RF-0798 | `website/app.js:112 <anonymous@112:23>` | pass | 1 | 0% | 2 | 0/0 | P4 / W5 | test-hardening-when-touched | Changed branch coverage >=80%; extracted functions CC <=30 and CRAP <30; no mutation regression. |
| RF-0799 | `website/app.js:113 <anonymous@113:35>` | pass | 1 | 0% | 2 | 0/0 | P4 / W5 | test-hardening-when-touched | Changed branch coverage >=80%; extracted functions CC <=30 and CRAP <30; no mutation regression. |
| RF-0800 | `website/app.js:115 <anonymous@115:27>` | pass | 1 | 0% | 2 | 0/0 | P4 / W5 | test-hardening-when-touched | Changed branch coverage >=80%; extracted functions CC <=30 and CRAP <30; no mutation regression. |
| RF-0801 | `website/app.js:151 <anonymous@151:23>` | pass | 1 | 0% | 2 | 0/0 | P4 / W5 | test-hardening-when-touched | Changed branch coverage >=80%; extracted functions CC <=30 and CRAP <30; no mutation regression. |
| RF-0802 | `website/app.js:152 <anonymous@152:35>` | pass | 1 | 0% | 2 | 0/0 | P4 / W5 | test-hardening-when-touched | Changed branch coverage >=80%; extracted functions CC <=30 and CRAP <30; no mutation regression. |
| RF-0803 | `website/app.js:153 <anonymous@153:27>` | pass | 1 | 0% | 2 | 0/0 | P4 / W5 | test-hardening-when-touched | Changed branch coverage >=80%; extracted functions CC <=30 and CRAP <30; no mutation regression. |
| RF-0804 | `website/app.js:165 <anonymous@165:18>` | pass | 1 | 0% | 2 | 0/0 | P4 / W5 | test-hardening-when-touched | Changed branch coverage >=80%; extracted functions CC <=30 and CRAP <30; no mutation regression. |
| RF-0805 | `website/app.js:168 <anonymous@168:25>` | pass | 1 | 0% | 2 | 0/0 | P4 / W5 | test-hardening-when-touched | Changed branch coverage >=80%; extracted functions CC <=30 and CRAP <30; no mutation regression. |
| RF-0806 | `website/demo/src/main.js:3 <anonymous@3:50>` | pass | 1 | 0% | 2 | 0/0 | P4 / W5 | test-hardening-when-touched | Changed branch coverage >=80%; extracted functions CC <=30 and CRAP <30; no mutation regression. |
| RF-0807 | `website/demo/src/main.js:6 <anonymous@6:71>` | pass | 1 | 0% | 2 | 0/0 | P4 / W5 | test-hardening-when-touched | Changed branch coverage >=80%; extracted functions CC <=30 and CRAP <30; no mutation regression. |
| RF-0926 | `website/demo/src/deck.js:36 <anonymous@36:19>` | pass | 1 | 66.67% | 1.04 | 2/0 | P4 / W5 | test-hardening-when-touched | Changed branch coverage >=80%; extracted functions CC <=30 and CRAP <30; no mutation regression. |
| RF-0931 | `website/demo/src/deck.js:3 initDeck` | pass | 1 | 70.83% | 1.02 | 47/2 | P4 / W5 | test-hardening-when-touched | Changed branch coverage >=80%; extracted functions CC <=30 and CRAP <30; no mutation regression. |
| RF-0932 | `website/demo/src/deck.js:26 <anonymous@26:38>` | pass | 1 | 70.83% | 1.02 | 0/0 | P4 / W5 | test-hardening-when-touched | Changed branch coverage >=80%; extracted functions CC <=30 and CRAP <30; no mutation regression. |
| RF-0933 | `website/demo/src/deck.js:59 <anonymous@59:38>` | pass | 1 | 70.83% | 1.02 | 3/0 | P4 / W5 | test-hardening-when-touched | Changed branch coverage >=80%; extracted functions CC <=30 and CRAP <30; no mutation regression. |
| RF-0934 | `website/demo/src/deck.js:60 <anonymous@60:38>` | pass | 1 | 70.83% | 1.02 | 0/0 | P4 / W5 | test-hardening-when-touched | Changed branch coverage >=80%; extracted functions CC <=30 and CRAP <30; no mutation regression. |
| RF-0935 | `website/demo/src/deck.js:101 <anonymous@101:43>` | pass | 1 | 70.83% | 1.02 | 0/0 | P4 / W5 | test-hardening-when-touched | Changed branch coverage >=80%; extracted functions CC <=30 and CRAP <30; no mutation regression. |
| RF-3396 | `website/demo/src/deck.js:48 update` | pass | 1 | 100% | 1 | 6/0 | P5 / continuous | preserve | Keep CRAP <20, retain coverage floor, and introduce no mutation regression. |
| RF-3397 | `website/demo/src/deck.js:54 <anonymous@54:47>` | pass | 1 | 100% | 1 | 5/0 | P5 / continuous | preserve | Keep CRAP <20, retain coverage floor, and introduce no mutation regression. |
