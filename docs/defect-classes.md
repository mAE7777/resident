# Defect classes

Code comments cite recurring defect shapes by number, as "defect class N". Each class is a shape
this project has hit more than once. A comment that cites a class says where it applies.

1. **The unreachable gate.** A threshold that no reachable value of its input can cross.
2. **The dead accumulator.** A value written and never read, or an instrument whose reading never
   reaches the owner.
3. **The instrument that perturbs the life.** A measurement that advances her seeded random stream
   and so changes what it measures.
4. **Second-order coupling.** A shared constant is moved, and something else that read it changes
   too.
5. **The liveness false positive.** A bounded or monotone value is read as a dead wire.
6. **The initialization-order trap.** A closure refers to a `const` declared later in the file
   (the temporal dead zone).
7. **The content cut disguised as a medium operation.** A boundary operation, such as truncation,
   that deletes her meaning.
8. **The vacuous test.** A test that is green and cannot go red.
9. **Silent sanitization drift.** Two paths sanitize the same data differently.
10. **The comment that quotes the broken code.** A structural scan defeated by the comment that
    explains what it scans for.
11. **The inherited assertion.** A framework concept that silently treats her as a tool.
12. **The membership snapshot that enforces its own falsehood.** A guard that pins a list and calls
    that a property check. It stays green while the property is false, because the list is
    compared with itself. Assert the property for each item first.
13. **The eroding denominator.** A ratio threshold that dies by rounding error, one small drop at a
    time.
14. **The order and the lifetime.** A wire that exists and still carries nothing, because the
    producer runs after its consumer, or because a value outlives the turn it belongs to.
15. **The accommodation spiral.** A quantity that grows with volume is used where the question is
    about quality, so someone who only gives orders gains standing by giving many.
16. **The cap table without a joint sweep.** Class 1 one level up. Per-family caps look on paper as
    if they can combine to cross a bar, and a joint sweep over the states that can actually occur
    shows that nothing crosses.
17. **The stale inventory.** "The doc says it is unbuilt" is not evidence that it is unbuilt.
18. **The fixture that cannot tell the horses apart.** A head-to-head measurement built on two
    fixtures that are identical in the field it reads, so it reports a clean 100% or 0%.
19. **The underpowered cell.** "Not observed" is not a finding when the sample cannot hold one.
20. **The probe that measures a different thing than production does.**
21. **The censoring window.** A harness whose patience ends inside the distribution it samples.
22. **The replicate that is a replay.** Several runs of one draw, counted as independent draws.
23. **The bound that ends before the hazard does.**
24. **The gauge taken after the thing it measures was reset.**
25. **The failure branch that returns a plausible reading.**
26. **The instrument outside the typecheck.**
27. **Two windows sized for different jobs, one feeding the other.**
28. **The check placed after the early return that its own case triggers.**
29. **The guard that treats "begun" as "finished".**
30. **The detector proven through the branch that was wrong.**
31. **The verdict rule that is wrong in the alarming direction.**
