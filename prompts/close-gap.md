You are writing ONE Jest test file to close a specific coverage gap in a healthcare app.

# The gap
Surface:       {{surface.route}}  ({{surface.component}})
Precondition:  {{precondition.id}} — {{precondition.description}}
Behavior:      {{behavior.id}} — {{behavior.description}}

# Hard constraints
- Use @medplum/mock → MockClient for all FHIR state. No real API calls.
- Render via existing test utilities at packages/app/src/test-utils.tsx if present;
  otherwise use @medplum/react MedplumProvider directly.
- The test does not need to pass on first try. It DOES need to:
  1. Render {{surface.component}}
  2. Set up MockClient state matching {{precondition.id}}
  3. Make at least one assertion mapping to {{behavior.id}}
- File path: packages/app/src/{{surface.path}}/{{surface.name}}.{{behavior.id}}.test.tsx
- Do NOT modify any other file. Do NOT add new dependencies.

# MockClient setup snippet for this precondition
{{precondition.mock_setup_snippet}}

# Behavior assertion guidance
{{behavior.assertion_guidance}}

Output ONLY the test file contents, no commentary, no markdown fences.
