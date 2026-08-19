# V30.11.4 — Apply after three useful pins

The V30.11.0 Apply gate was too strict. It required every selected pin to be ready, 8 ROI views, 4 azimuth sectors, 14 cm baseline, three global poses with three pins visible, and all selected pins in the final common frame.

V30.11.4 changes the acceptance rule:

- at least 3 useful XRAnchor-backed pins;
- each useful pin: >=3 separated tracking views, >=4 ROI views and >=8 cm baseline;
- at least 3 useful pins visible together in the final common view;
- only a minimal non-degeneracy check (spatial span + triangle area + screen triangle area);
- global pose coverage is still recorded but does not gate Apply;
- extra incomplete/off-screen pins never block Apply and are not stored in the applied profile.

The UI explicitly shows `PRONTO` and enables `Applica` as soon as these conditions are met.
