    <script>
        // Global state
        let objFileContent = null;
        let templateFileContent = null;
        let generatedContent = null;
        let currentMode = 'generate';

        // Review system state
        let soundEntries = [];
        let currentFilter = 'all';
        let nextEntryId = 1;
        let currentDiffs = [];
        let currentFilename = 'aircraft_sounds.snd';
        let userCategories = [];
        let searchText = '';

        // ========================================================================
        // CLASS DEFINITIONS
        // ========================================================================

        class SoundEntry {
            constructor(data) {
                this.id = data.id || `entry_${nextEntryId++}`;
                this.eventName = data.eventName || '/aircraft/sound';
                this.triggerType = data.triggerType || 'EVENT_START_COND';
                this.startCond = data.startCond || '';
                this.endCond = data.endCond || '';
                this.command = data.command || '';
                this.cueTrigger = data.cueTrigger || '';
                this.autoEndCond = data.autoEndCond || '';
                this.xyz = data.xyz || [0, 0, 0];
                this.polyphonic = data.polyphonic || false;
                this.allowedForAI = data.allowedForAI || false;
                this.deleted = false;
                this.vehPart = data.vehPart || null;
                this.paramDrefIdx = data.paramDrefIdx !== undefined ? data.paramDrefIdx : null;
                this.isTemplate = data.isTemplate || false;
                this.comment = data.comment || '';
                this.completed = data.completed || false;
                this.selected = false;
            }

            toSND() {
                if (this.deleted) return '';

                let output = '';

                if (this.comment) {
                    output += `# ${this.comment}\n`;
                }

                output += 'BEGIN_SOUND_ATTACHMENT\n';
                output += `\tEVENT_NAME ${this.eventName}\n`;

                if (this.vehPart) {
                    output += `\tVEH_PART ${this.vehPart}\n`;
                } else {
                    output += `\tVEH_XYZ ${this.xyz[0].toFixed(3)} ${this.xyz[1].toFixed(3)} ${this.xyz[2].toFixed(3)}\n`;
                }

                if (this.polyphonic) {
                    output += `\tEVENT_POLYPHONIC\n`;
                }

                if (this.allowedForAI) {
                    output += `\tEVENT_ALLOWED_FOR_AI\n`;
                }

                if (this.paramDrefIdx !== null) {
                    output += `\tPARAM_DREF_IDX ${this.paramDrefIdx}\n`;
                }

                switch (this.triggerType) {
                    case 'EVENT_START_COND':
                        if (this.startCond) output += `\tEVENT_START_COND ${this.startCond}\n`;
                        if (this.endCond) output += `\tEVENT_END_COND ${this.endCond}\n`;
                        break;
                    case 'EVENT_CMND_DOWN':
                        if (this.command) output += `\tEVENT_CMND_DOWN ${this.command}\n`;
                        break;
                    case 'EVENT_CMND_UP':
                        if (this.command) output += `\tEVENT_CMND_UP ${this.command}\n`;
                        break;
                    case 'EVENT_CMND_HOLD_STOP':
                        if (this.command) output += `\tEVENT_CMND_HOLD_STOP ${this.command}\n`;
                        break;
                    case 'EVENT_CMND_HOLD_CUE':
                        if (this.command) output += `\tEVENT_CMND_HOLD_CUE ${this.command}\n`;
                        break;
                    case 'CUE_TRIGGER_COND':
                        if (this.cueTrigger) output += `\tCUE_TRIGGER_COND ${this.cueTrigger}\n`;
                        break;
                }

                if (this.autoEndCond) {
                    output += `\tEVENT_AUTO_END_FROM_START_COND ${this.autoEndCond}\n`;
                }

                output += 'END_SOUND_ATTACHMENT\n\n';
                return output;
            }
        }

        class OBJParser {
            constructor(content) {
                this.content = content;
                this.vertices = [];
                this.manipulators = [];
            }

            parse() {
                const lines = this.content.split('\n');

                for (const line of lines) {
                    if (line.startsWith('VT\t') || line.startsWith('VT ')) {
                        this.parseVertex(line);
                    }
                }

                let currentVertexOffset = 0;

                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i].trim();

                    if (line.startsWith('TRIS')) {
                        const parts = line.split(/\s+/);
                        if (parts.length >= 2) {
                            currentVertexOffset = parseInt(parts[1]) || 0;
                        }
                    }

                    if (line.includes('ATTR_manip') && !line.includes('ATTR_manip_none')) {
                        const manip = this.parseManipulator(line, i + 1);
                        if (manip && currentVertexOffset < this.vertices.length) {
                            manip.xyz = this.vertices[currentVertexOffset];
                            this.manipulators.push(manip);
                        }
                    }
                }

                return {
                    vertices: this.vertices,
                    manipulators: this.manipulators
                };
            }

            parseVertex(line) {
                const parts = line.split(/\s+/);
                if (parts.length >= 4) {
                    const x = parseFloat(parts[1]);
                    const y = parseFloat(parts[2]);
                    const z = parseFloat(parts[3]);
                    if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
                        this.vertices.push([x, y, z]);
                    }
                }
            }

            parseManipulator(line, lineNum) {
                const parts = line.split('\t').filter(p => p.trim());

                if (parts.length < 3) return null;

                const manipType = parts[0].replace('ATTR_manip_', '');
                const cursor = parts[1] || 'hand';
                const command = parts[2] || '';
                const tooltip = parts[3] || '';

                return {
                    manipType,
                    cursor,
                    command,
                    tooltip,
                    xyz: [0, 0, 0],
                    lineNumber: lineNum
                };
            }
        }

        class SNDUpdater {
            constructor(sndContent) {
                this.content = sndContent;
                this.originalLines = sndContent.split('\n');
            }

            // identifyChanges returns a list of proposed updates
            identifyChanges(commandMap) {
                const lines = [...this.originalLines]; // Copy
                let changes = [];
                let currentCommand = null;
                let currentEventName = 'Unknown Event';
                let pendingXYZLineIndex = null;
                let unmatched = [];

                // Stats
                let totalEntries = 0;
                let matched = 0;

                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    const trimmed = line.trim();

                    // Track when we enter a sound attachment block
                    if (trimmed === 'BEGIN_SOUND_ATTACHMENT') {
                        totalEntries++;
                        currentCommand = null;
                        currentEventName = 'Unknown Event';
                        pendingXYZLineIndex = null;
                    }

                    // Track Event Name
                    if (trimmed.startsWith('EVENT_NAME ')) {
                        currentEventName = trimmed.substring(11).trim();
                    }

                    // Mark VEH_XYZ lines for potential update
                    if (trimmed.startsWith('VEH_XYZ')) {
                        pendingXYZLineIndex = i;
                        continue;
                    }

                    // Extract command from EVENT_CMND_* lines
                    if (trimmed.startsWith('EVENT_CMND_HOLD_CUE') ||
                        trimmed.startsWith('EVENT_CMND_CUE') ||
                        trimmed.startsWith('EVENT_CMND_UP') ||
                        trimmed.startsWith('EVENT_CMND_DOWN') ||
                        trimmed.startsWith('EVENT_CMND_ONCE')) {

                        const parts = trimmed.split(/\s+/);
                        if (parts.length >= 2) {
                            currentCommand = parts.slice(1).join(' ');

                            // Check for match if we have a pending XYZ line
                            if (currentCommand && pendingXYZLineIndex !== null) {
                                if (commandMap.has(currentCommand)) {
                                    const newXYZ = commandMap.get(currentCommand);

                                    // Get old XYZ to see if it actually changed
                                    const oldLine = lines[pendingXYZLineIndex];
                                    const oldParts = oldLine.trim().substring(8).split(/\s+/);
                                    const oldXYZ = [parseFloat(oldParts[0]), parseFloat(oldParts[1]), parseFloat(oldParts[2])];

                                    // Simple distance check to avoid 0.000 vs -0.000 diffs or negligible changes
                                    const isDifferent =
                                        Math.abs(oldXYZ[0] - newXYZ[0]) > 0.001 ||
                                        Math.abs(oldXYZ[1] - newXYZ[1]) > 0.001 ||
                                        Math.abs(oldXYZ[2] - newXYZ[2]) > 0.001;

                                    if (isDifferent) {
                                        changes.push({
                                            id: changes.length,
                                            command: currentCommand,
                                            eventName: currentEventName,
                                            lineIndex: pendingXYZLineIndex,
                                            oldLine: oldLine, // Keep indentation
                                            oldXYZ: oldXYZ,
                                            newXYZ: newXYZ,
                                            selected: true // Default to checked
                                        });
                                    }

                                    matched++;
                                    pendingXYZLineIndex = null;
                                } else {
                                    if (!unmatched.includes(currentCommand)) {
                                        unmatched.push(currentCommand);
                                    }
                                }
                            }
                        }
                    }
                }

                return {
                    changes,
                    totalEntries,
                    matched,
                    unmatched
                };
            }
        }

        class SNDGenerator {
            constructor(templateContent) {
                this.template = templateContent;
            }

            getDefaultHeader() {
                return `A
1000
ACF_SOUNDS

#################################################
# Generated Sound Bank                          #
# Auto-generated by XPlane SND Generator        #
# ${new Date().toISOString()}                   #
#################################################

DISABLE_LEGACY_ALERT_SOUNDS

`;
            }

            getHeader() {
                if (!this.template) return this.getDefaultHeader();
                const idx = this.template.indexOf('BEGIN_SOUND_ATTACHMENT');
                if (idx > 0) return this.template.substring(0, idx);
                return this.getDefaultHeader();
            }

            generateTemplateSounds(templateSounds) {
                let output = '';

                if (templateSounds.engine) {
                    output += `# Engine Sound
BEGIN_SOUND_ATTACHMENT
\tEVENT_NAME /aircraft/engine/running
\tVEH_PART engine 0
\tPARAM_DREF_IDX 0
\tEVENT_START_COND sim/flightmodel2/engines/engine_rotation_speed_rad_sec[0] > 1
\tEVENT_END_COND sim/flightmodel2/engines/engine_rotation_speed_rad_sec[0] < 1
END_SOUND_ATTACHMENT

`;
                }

                if (templateSounds.propeller) {
                    output += `# Propeller Sound
BEGIN_SOUND_ATTACHMENT
\tEVENT_NAME /aircraft/propeller/running
\tVEH_PART prop 0
\tPARAM_DREF_IDX 0
\tEVENT_START_COND sim/flightmodel2/engines/prop_rotation_speed_rad_sec[0] > 1
\tEVENT_END_COND sim/flightmodel2/engines/prop_rotation_speed_rad_sec[0] < 1
END_SOUND_ATTACHMENT

`;
                }

                if (templateSounds.jet) {
                    output += `# Jet Engine Sound
BEGIN_SOUND_ATTACHMENT
\tEVENT_NAME /aircraft/jet/engine
\tVEH_PART engine 0
\tPARAM_DREF_IDX 0
\tEVENT_START_COND sim/flightmodel2/engines/N1_percent[0] > 5
\tEVENT_END_COND sim/flightmodel2/engines/N1_percent[0] < 5
END_SOUND_ATTACHMENT

`;
                }

                if (templateSounds.reverser) {
                    output += `# Thrust Reverser
BEGIN_SOUND_ATTACHMENT
\tEVENT_NAME /aircraft/reversers/deploy
\tVEH_PART engine 0
\tEVENT_START_COND sim/flightmodel2/engines/thrust_reverser_deploy_ratio[0] > 0.1
\tEVENT_END_COND sim/flightmodel2/engines/thrust_reverser_deploy_ratio[0] < 0.1
END_SOUND_ATTACHMENT

`;
                }

                if (templateSounds.gear) {
                    output += `# Landing Gear Extension
BEGIN_SOUND_ATTACHMENT
\tEVENT_NAME /aircraft/gear/extension
\tVEH_XYZ 0.000 0.000 0.000
\tEVENT_START_COND sim/flightmodel2/gear/deploy_ratio[0] > 0
\tEVENT_END_COND sim/flightmodel2/gear/deploy_ratio[0] == 0 OR sim/flightmodel2/gear/deploy_ratio[0] == 1
END_SOUND_ATTACHMENT

`;
                }

                if (templateSounds.tires) {
                    output += `# Tire Squeal on Landing
BEGIN_SOUND_ATTACHMENT
\tEVENT_NAME /aircraft/tires/squeal
\tVEH_XYZ 0.000 -1.000 0.000
\tEVENT_START_COND sim/flightmodel2/gear/tire_vertical_deflection_mtr[0] > 0.01
\tEVENT_END_COND sim/flightmodel2/gear/on_ground[0] == 0
END_SOUND_ATTACHMENT

`;
                }

                if (templateSounds.groundRoll) {
                    output += `# Ground Roll Rumble
BEGIN_SOUND_ATTACHMENT
\tEVENT_NAME /aircraft/ground/rumble
\tVEH_XYZ 0.000 0.000 0.000
\tEVENT_START_COND sim/flightmodel2/gear/on_ground[0] == 1 AND sim/flightmodel/position/groundspeed > 5
\tEVENT_END_COND sim/flightmodel2/gear/on_ground[0] == 0 OR sim/flightmodel/position/groundspeed < 5
END_SOUND_ATTACHMENT

`;
                }

                if (templateSounds.brakes) {
                    output += `# Brake Squeal
BEGIN_SOUND_ATTACHMENT
\tEVENT_NAME /aircraft/brakes/squeal
\tVEH_XYZ 0.000 -0.500 0.000
\tEVENT_START_COND sim/cockpit2/controls/parking_brake_ratio > 0.5 AND sim/flightmodel/position/groundspeed > 1
\tEVENT_END_COND sim/cockpit2/controls/parking_brake_ratio < 0.5 OR sim/flightmodel/position/groundspeed < 1
END_SOUND_ATTACHMENT

`;
                }

                if (templateSounds.flaps) {
                    output += `# Flaps Extension
BEGIN_SOUND_ATTACHMENT
\tEVENT_NAME /aircraft/flaps/extension
\tVEH_XYZ 0.000 0.000 2.000
\tEVENT_START_COND sim/flightmodel2/controls/flap_handle_deploy_ratio > 0
\tEVENT_END_COND sim/flightmodel2/wing/flap1_deg[0] == sim/aircraft/overflow/acf_flap_detents[0] OR sim/flightmodel2/wing/flap1_deg[0] == 0
END_SOUND_ATTACHMENT

`;
                }

                if (templateSounds.spoilers) {
                    output += `# Spoilers/Speedbrakes
BEGIN_SOUND_ATTACHMENT
\tEVENT_NAME /aircraft/spoilers/deploy
\tVEH_XYZ 0.000 0.000 1.000
\tEVENT_START_COND sim/flightmodel2/controls/speedbrake_ratio > 0.1
\tEVENT_END_COND sim/flightmodel2/controls/speedbrake_ratio < 0.1
END_SOUND_ATTACHMENT

`;
                }

                if (templateSounds.trimWheel) {
                    output += `# Trim Wheel
BEGIN_SOUND_ATTACHMENT
\tEVENT_NAME /aircraft/trim/wheel
\tVEH_XYZ 0.000 0.500 0.000
\tEVENT_CMND_CUE sim/flight_controls/pitch_trim_down
END_SOUND_ATTACHMENT

BEGIN_SOUND_ATTACHMENT
\tEVENT_NAME /aircraft/trim/wheel
\tVEH_XYZ 0.000 0.500 0.000
\tEVENT_CMND_CUE sim/flight_controls/pitch_trim_up
END_SOUND_ATTACHMENT

`;
                }

                if (templateSounds.stallWarning) {
                    output += `# Stall Warning
BEGIN_SOUND_ATTACHMENT
\tEVENT_NAME /aircraft/warning/stall
\tVEH_XYZ 0.000 0.500 -0.500
\tEVENT_START_COND sim/flightmodel/failures/stallwarning_on == 1
\tEVENT_END_COND sim/flightmodel/failures/stallwarning_on == 0
END_SOUND_ATTACHMENT

`;
                }

                if (templateSounds.gearWarning) {
                    output += `# Gear Warning Horn
BEGIN_SOUND_ATTACHMENT
\tEVENT_NAME /aircraft/warning/gear_horn
\tVEH_XYZ 0.000 0.500 -0.500
\tEVENT_START_COND sim/cockpit2/annunciators/gear_warning == 1
\tEVENT_END_COND sim/cockpit2/annunciators/gear_warning == 0
END_SOUND_ATTACHMENT

`;
                }

                if (templateSounds.overspeed) {
                    output += `# Overspeed Warning
BEGIN_SOUND_ATTACHMENT
\tEVENT_NAME /aircraft/warning/overspeed
\tVEH_XYZ 0.000 0.500 -0.500
\tEVENT_START_COND sim/flightmodel/failures/over_vne == 1
\tEVENT_END_COND sim/flightmodel/failures/over_vne == 0
END_SOUND_ATTACHMENT

`;
                }

                if (templateSounds.masterWarning) {
                    output += `# Master Warning/Caution
BEGIN_SOUND_ATTACHMENT
\tEVENT_NAME /aircraft/warning/master_warning
\tVEH_XYZ 0.000 0.500 -0.500
\tEVENT_START_COND sim/cockpit2/annunciators/master_warning == 1
\tEVENT_END_COND sim/cockpit2/annunciators/master_warning == 0
END_SOUND_ATTACHMENT

BEGIN_SOUND_ATTACHMENT
\tEVENT_NAME /aircraft/warning/master_caution
\tVEH_XYZ 0.000 0.500 -0.500
\tEVENT_START_COND sim/cockpit2/annunciators/master_caution == 1
\tEVENT_END_COND sim/cockpit2/annunciators/master_caution == 0
END_SOUND_ATTACHMENT

`;
                }

                if (templateSounds.wind) {
                    output += `# Wind Noise
BEGIN_SOUND_ATTACHMENT
\tEVENT_NAME /aircraft/environment/wind
\tVEH_XYZ 0.000 0.500 0.000
\tEVENT_START_COND sim/flightmodel/position/indicated_airspeed > 30
\tEVENT_END_COND sim/flightmodel/position/indicated_airspeed < 30
END_SOUND_ATTACHMENT

`;
                }

                if (templateSounds.rain) {
                    output += `# Rain on Canopy
BEGIN_SOUND_ATTACHMENT
\tEVENT_NAME /aircraft/environment/rain
\tVEH_XYZ 0.000 1.000 0.000
\tEVENT_START_COND sim/weather/rain_percent > 0.1
\tEVENT_END_COND sim/weather/rain_percent < 0.1
END_SOUND_ATTACHMENT

`;
                }

                return output;
            }

            generate(manipulators, eventName, useHoldCue, duplicateForRelease, templateSounds) {
                let output = this.getHeader();

                output += "# Template Sound Blocks\n";
                output += "#############################################################################################\n";
                output += this.generateTemplateSounds(templateSounds);
                output += "\n";

                output += "# Manipulator Sounds\n";
                output += "#############################################################################################\n";

                const seenCommands = new Set();

                for (const manip of manipulators) {
                    if (seenCommands.has(manip.command)) continue;
                    seenCommands.add(manip.command);

                    if (manip.tooltip) {
                        output += `# ${manip.tooltip}\n`;
                    }

                    output += 'BEGIN_SOUND_ATTACHMENT\n';
                    output += `\tEVENT_NAME ${eventName}\n`;
                    output += `\tVEH_XYZ ${manip.xyz[0].toFixed(3)} ${manip.xyz[1].toFixed(3)} ${manip.xyz[2].toFixed(3)}\n`;

                    if (useHoldCue) {
                        output += `\tEVENT_CMND_HOLD_CUE ${manip.command}\n`;
                    } else {
                        output += `\tEVENT_CMND_CUE ${manip.command}\n`;
                    }

                    output += 'END_SOUND_ATTACHMENT\n\n';

                    if (duplicateForRelease) {
                        output += `# ${manip.tooltip || manip.command} - Release\n`;
                        output += 'BEGIN_SOUND_ATTACHMENT\n';
                        output += `\tEVENT_NAME ${eventName}\n`;
                        output += `\tVEH_XYZ ${manip.xyz[0].toFixed(3)} ${manip.xyz[1].toFixed(3)} ${manip.xyz[2].toFixed(3)}\n`;
                        output += `\tEVENT_CMND_UP ${manip.command}\n`;
                        output += 'END_SOUND_ATTACHMENT\n\n';
                    }
                }

                return output;
            }
        }

        class SNDEventParser {
            constructor(sndContent) {
                this.content = sndContent;
            }

            extractEvents() {
                const lines = this.content.split('\n');
                const events = new Set();

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (trimmed.startsWith('EVENT_NAME')) {
                        const parts = trimmed.split(/\s+/);
                        if (parts.length >= 2) {
                            const eventPath = parts.slice(1).join(' ');
                            if (eventPath.startsWith('/')) {
                                events.add(eventPath);
                            }
                        }
                    }
                }

                return Array.from(events).sort();
            }
        }

        class FMODPackageBuilder {
            constructor(packageName, createPlaceholders, includeReadme) {
                this.packageName = packageName;
                this.createPlaceholders = createPlaceholders;
                this.includeReadme = includeReadme;
                this.stats = {
                    folders: 0,
                    files: 0
                };
            }

            async build(events) {
                const zip = new JSZip();

                // Create folder structure for each event
                for (const eventPath of events) {
                    // Convert /aircraft/generic/switch to aircraft/generic/switch/
                    const cleanPath = eventPath.substring(1); // Remove leading /
                    const parts = cleanPath.split('/');
                    const eventName = parts[parts.length - 1] || 'event';
                    const folderPath = cleanPath;

                    // Create folder
                    const folder = zip.folder(folderPath);
                    this.stats.folders++;

                    // Create placeholder audio file if requested
                    if (this.createPlaceholders) {
                        // Create minimal WAV file header (empty 1 second mono 44.1kHz)
                        const wavData = this.createEmptyWav();
                        folder.file(`${eventName}.wav`, wavData);
                        this.stats.files++;
                    }

                    // Create event metadata file
                    const metadata = {
                        eventPath: eventPath,
                        eventName: eventName,
                        generatedBy: 'X-Plane SND Generator',
                        timestamp: new Date().toISOString(),
                        note: 'Replace placeholder audio with your actual sound file'
                    };
                    folder.file('_event_info.json', JSON.stringify(metadata, null, 2));
                    this.stats.files++;
                }

                // Create README if requested
                if (this.includeReadme) {
                    const readme = this.generateReadme(events);
                    zip.file('README.txt', readme);
                    this.stats.files++;
                }

                // Create structure map
                const structureMap = this.generateStructureMap(events);
                zip.file('_STRUCTURE_MAP.txt', structureMap);
                this.stats.files++;

                // Generate ZIP blob
                return await zip.generateAsync({
                    type: 'blob',
                    compression: 'DEFLATE',
                    compressionOptions: { level: 6 }
                });
            }

            createEmptyWav() {
                // Create a minimal valid WAV file (1 second of silence, mono, 44.1kHz, 16-bit)
                const sampleRate = 44100;
                const numChannels = 1;
                const bitsPerSample = 16;
                const duration = 1; // 1 second
                const numSamples = sampleRate * duration;
                const dataSize = numSamples * numChannels * (bitsPerSample / 8);
                const fileSize = 44 + dataSize;

                const buffer = new ArrayBuffer(fileSize);
                const view = new DataView(buffer);

                // RIFF header
                this.writeString(view, 0, 'RIFF');
                view.setUint32(4, fileSize - 8, true);
                this.writeString(view, 8, 'WAVE');

                // fmt chunk
                this.writeString(view, 12, 'fmt ');
                view.setUint32(16, 16, true); // fmt chunk size
                view.setUint16(20, 1, true); // audio format (PCM)
                view.setUint16(22, numChannels, true);
                view.setUint32(24, sampleRate, true);
                view.setUint32(28, sampleRate * numChannels * (bitsPerSample / 8), true); // byte rate
                view.setUint16(32, numChannels * (bitsPerSample / 8), true); // block align
                view.setUint16(34, bitsPerSample, true);

                // data chunk
                this.writeString(view, 36, 'data');
                view.setUint32(40, dataSize, true);

                // Audio data (silence = all zeros, already initialized)

                return buffer;
            }

            writeString(view, offset, string) {
                for (let i = 0; i < string.length; i++) {
                    view.setUint8(offset + i, string.charCodeAt(i));
                }
            }

            generateReadme(events) {
                return `X-PLANE FMOD STUDIO PACKAGE
Generated: ${new Date().toLocaleString()}
Package: ${this.packageName}

===========================================
INSTALLATION INSTRUCTIONS
===========================================

1. Extract this ZIP file
2. Open your FMOD Studio project
3. Navigate to the Events folder in the Events tab
4. Drag and drop the extracted folders into your Events folder
5. Replace placeholder .wav files with your actual audio files
6. Build your FMOD banks

===========================================
FOLDER STRUCTURE
===========================================

This package contains ${events.length} event paths organized into folders:

${events.map(e => `  ${e}`).join('\n')}

===========================================
PLACEHOLDER FILES
===========================================

${this.createPlaceholders ?
                        `Each event folder contains:
  - [event_name].wav - Placeholder audio file (1 second silence)
  - _event_info.json - Event metadata

Replace the .wav files with your actual sound files.
The _event_info.json files are for reference only.` :
                        `Each event folder contains:
  - _event_info.json - Event metadata

Add your .wav audio files to each folder.`}

===========================================
NOTES
===========================================

- Event paths match your .snd file exactly
- File names should match the last segment of the event path
- You can rename audio files within FMOD Studio
- Keep the folder structure intact for proper event mapping

===========================================
EXPERIMENTAL FEATURE
===========================================

This package generator is experimental. Please verify
the folder structure matches your FMOD Studio project
requirements before importing.

For questions or issues, refer to the X-Plane FMOD
documentation or community forums.
`;
            }

            generateStructureMap(events) {
                let output = `FMOD STUDIO EVENT STRUCTURE MAP\n`;
                output += `Generated: ${new Date().toLocaleString()}\n`;
                output += `Package: ${this.packageName}\n`;
                output += `Total Events: ${events.length}\n`;
                output += `\n${'='.repeat(60)}\n\n`;

                // Group events by top-level folder
                const grouped = {};
                for (const event of events) {
                    const parts = event.split('/').filter(p => p);
                    const topLevel = parts[0] || 'root';
                    if (!grouped[topLevel]) grouped[topLevel] = [];
                    grouped[topLevel].push(event);
                }

                for (const [category, paths] of Object.entries(grouped)) {
                    output += `${category}/\n`;
                    for (const path of paths) {
                        const indent = '  '.repeat(path.split('/').length - 2);
                        const name = path.split('/').pop();
                        output += `${indent}├─ ${name}\n`;
                    }
                    output += '\n';
                }

                return output;
            }
        }

        // Mode switching
        function switchMode(mode) {
            currentMode = mode;

            const generateBtn = document.getElementById('generateModeBtn');
            const updateBtn = document.getElementById('updateModeBtn');
            const fmodBtn = document.getElementById('fmodModeBtn');
            const generateContent = document.getElementById('generateContent');
            const updateContent = document.getElementById('updateContent');
            const fmodContent = document.getElementById('fmodContent');
            const modeDesc = document.getElementById('modeDescription');

            // Remove all active states
            generateBtn.classList.remove('active');
            updateBtn.classList.remove('active');
            fmodBtn.classList.remove('active');
            generateContent.classList.add('hidden');
            updateContent.classList.add('hidden');
            fmodContent.classList.add('hidden');

            if (mode === 'generate') {
                generateBtn.classList.add('active');
                generateContent.classList.remove('hidden');
                modeDesc.textContent = 'Generate a complete .snd file from cockpit.obj manipulators with template sound blocks';
            } else if (mode === 'update') {
                updateBtn.classList.add('active');
                updateContent.classList.remove('hidden');
                modeDesc.textContent = 'Update XYZ coordinates in an existing .snd file by matching commands with cockpit.obj manipulators (fixes Blender Y/Z axis flip)';
            } else if (mode === 'fmod') {
                fmodBtn.classList.add('active');
                fmodContent.classList.remove('hidden');
                modeDesc.innerHTML = 'FMOD Documentation, tutorials, and community resources to help you build great sounds for X-Plane.';
            }
        }

        // Event name selector
        document.getElementById('eventName').addEventListener('change', function () {
            const customGroup = document.getElementById('customEventGroup');
            customGroup.classList.toggle('hidden', this.value !== 'custom');
        });

        // File drop zones for GENERATE mode
        setupDropZone('objDropZone', 'objFile', (content, filename) => {
            objFileContent = content;
            showFileInfo('objFileInfo', filename, content.length);
        });

        setupDropZone('templateDropZone', 'templateFile', (content, filename) => {
            templateFileContent = content;
            showFileInfo('templateFileInfo', filename, content.length);
        });

        // File drop zones for UPDATE mode
        let objFileContentUpdate = null;
        let sndFileContent = null;
        let updatedContent = null;

        setupDropZone('objDropZoneUpdate', 'objFileUpdate', (content, filename) => {
            objFileContentUpdate = content;
            showFileInfo('objFileInfoUpdate', filename, content.length);
        });

        setupDropZone('sndDropZone', 'sndFile', (content, filename) => {
            sndFileContent = content;
            showFileInfo('sndFileInfo', filename, content.length);
        });

        // File drop zone for FMOD mode
        let sndFileFmodContent = null;
        let fmodPackageBlob = null;

        setupDropZone('sndDropZoneFmod', 'sndFileFmod', (content, filename) => {
            sndFileFmodContent = content;
            showFileInfo('sndFileInfoFmod', filename, content.length);
        });

        function setupDropZone(dropZoneId, inputId, callback) {
            const dropZone = document.getElementById(dropZoneId);
            const fileInput = document.getElementById(inputId);

            dropZone.addEventListener('click', () => fileInput.click());

            dropZone.addEventListener('dragover', (e) => {
                e.preventDefault();
                dropZone.classList.add('drag-over');
            });

            dropZone.addEventListener('dragleave', () => {
                dropZone.classList.remove('drag-over');
            });

            dropZone.addEventListener('drop', (e) => {
                e.preventDefault();
                dropZone.classList.remove('drag-over');
                const file = e.dataTransfer.files[0];
                if (file) readFile(file, callback);
            });

            fileInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) readFile(file, callback);
            });
        }

        function readFile(file, callback) {
            const reader = new FileReader();
            reader.onload = (e) => callback(e.target.result, file.name);
            reader.readAsText(file);
        }

        function showFileInfo(elementId, filename, size) {
            const element = document.getElementById(elementId);
            const sizeKB = (size / 1024).toFixed(1);

            let fileType = 'template';
            if (elementId.includes('Update') || elementId.includes('update')) {
                fileType = 'update';
            } else if (elementId.includes('snd') && elementId.includes('Fmod')) {
                fileType = 'fmod';
            } else if (elementId.includes('snd')) {
                fileType = 'snd';
            } else if (elementId === 'objFileInfo') {
                fileType = 'obj';
            }

            element.innerHTML = `
                <div class="file-info">
                    <div>
                        <div class="file-name">
                            <span>✓</span>
                            <span>${filename}</span>
                        </div>
                        <div class="file-size">${sizeKB} KB</div>
                    </div>
                    <button class="remove-btn" onclick="removeFile('${elementId}', '${fileType}')">×</button>
                </div>
            `;
            element.classList.remove('hidden');
        }

        function removeFile(infoId, type) {
            document.getElementById(infoId).classList.add('hidden');
            if (type === 'obj') {
                objFileContent = null;
                document.getElementById('objFile').value = '';
            } else if (type === 'template') {
                templateFileContent = null;
                document.getElementById('templateFile').value = '';
            } else if (type === 'update') {
                objFileContentUpdate = null;
                document.getElementById('objFileUpdate').value = '';
            } else if (type === 'snd') {
                sndFileContent = null;
                document.getElementById('sndFile').value = '';
            } else if (type === 'fmod') {
                sndFileFmodContent = null;
                document.getElementById('sndFileFmod').value = '';
            }
        }

        function log(message, type = 'info', consoleId = 'console') {
            const console = document.getElementById(consoleId);
            const line = document.createElement('div');
            line.className = `console-line ${type}`;
            const timestamp = new Date().toLocaleTimeString();
            line.textContent = `[${timestamp}] ${message}`;
            console.appendChild(line);
            console.scrollTop = console.scrollHeight;
        }

        function clearConsole(consoleId = 'console') {
            document.getElementById(consoleId).innerHTML = '';
        }

        function getFilterSettings() {
            return {
                excludeDragAxis: document.getElementById('excludeDragAxis').checked,
                excludeDragXY: document.getElementById('excludeDragXY').checked,
                excludeAxisKnob: document.getElementById('excludeAxisKnob').checked,
                excludeNoop: document.getElementById('excludeNoop').checked
            };
        }

        function getTemplateSoundSettings() {
            return {
                engine: document.getElementById('includeEngine').checked,
                propeller: document.getElementById('includePropeller').checked,
                jet: document.getElementById('includeJet').checked,
                reverser: document.getElementById('includeReverser').checked,
                gear: document.getElementById('includeGear').checked,
                tires: document.getElementById('includeTires').checked,
                groundRoll: document.getElementById('includeGroundRoll').checked,
                brakes: document.getElementById('includeBrakes').checked,
                flaps: document.getElementById('includeFlaps').checked,
                spoilers: document.getElementById('includeSpoilers').checked,
                trimWheel: document.getElementById('includeTrimWheel').checked,
                stallWarning: document.getElementById('includeStallWarning').checked,
                gearWarning: document.getElementById('includeGearWarning').checked,
                overspeed: document.getElementById('includeOverspeed').checked,
                masterWarning: document.getElementById('includeMasterWarning').checked,
                wind: document.getElementById('includeWind').checked,
                rain: document.getElementById('includeRain').checked
            };
        }

        // UPDATE XYZ MODE FUNCTION
        async function updateXYZ() {
            if (!objFileContentUpdate) {
                alert('Please upload a cockpit.obj file!');
                return;
            }
            if (!sndFileContent) {
                alert('Please upload your existing .snd file!');
                return;
            }

            const startTime = performance.now();

            document.getElementById('outputSectionUpdate').classList.remove('hidden');
            clearConsole('consoleUpdate');
            document.getElementById('statsGridUpdate').classList.add('hidden');
            document.getElementById('downloadBtnUpdate').classList.add('hidden');

            const progressBar = document.getElementById('progressBarUpdate');
            const progressFill = document.getElementById('progressFillUpdate');
            progressBar.classList.remove('hidden');
            progressFill.style.width = '10%';

            document.getElementById('updateBtn').disabled = true;

            log('Starting XYZ coordinate update...', 'info', 'consoleUpdate');

            try {
                // Parse OBJ file
                const parser = new OBJParser(objFileContentUpdate);
                const result = parser.parse();

                progressFill.style.width = '40%';
                log(`Parsed ${result.vertices.length} vertices`, 'success', 'consoleUpdate');
                log(`Found ${result.manipulators.length} manipulators`, 'success', 'consoleUpdate');

                // Build command -> XYZ map
                const commandMap = new Map();
                for (const manip of result.manipulators) {
                    if (manip.command && !commandMap.has(manip.command)) {
                        commandMap.set(manip.command, manip.xyz);
                    }
                }

                progressFill.style.width = '60%';
                log('Built command-to-coordinate mapping. Identifying changes...', 'info', 'consoleUpdate');

                // Identify Changes (Don't update yet)
                const updater = new SNDUpdater(sndFileContent);
                let results;

                try {
                    results = updater.identifyChanges(commandMap);
                    currentEntry.endCond = trimmed.substring(15);
                } else if (trimmed.startsWith('EVENT_CMND_DOWN ')) {
                    currentEntry.command = trimmed.substring(16);
                    currentEntry.triggerType = 'EVENT_CMND_DOWN';
                } else if (trimmed.startsWith('EVENT_CMND_UP ')) {
                    currentEntry.command = trimmed.substring(14);
                    currentEntry.triggerType = 'EVENT_CMND_UP';
                } else if (trimmed.startsWith('EVENT_CMND_HOLD_STOP ')) {
                    currentEntry.command = trimmed.substring(21);
                    currentEntry.triggerType = 'EVENT_CMND_HOLD_STOP';
                } else if (trimmed.startsWith('EVENT_CMND_HOLD_CUE ')) {
                    currentEntry.command = trimmed.substring(20);
                    currentEntry.triggerType = 'EVENT_CMND_HOLD_CUE';
                } else if (trimmed.startsWith('CUE_TRIGGER_COND ')) {
                    currentEntry.cueTrigger = trimmed.substring(17);
                    currentEntry.triggerType = 'CUE_TRIGGER_COND';
                } else if (trimmed.startsWith('EVENT_AUTO_END_FROM_START_COND ')) {
                    currentEntry.autoEndCond = trimmed.substring(32);
                } else if (trimmed === 'EVENT_POLYPHONIC') {
                    currentEntry.polyphonic = true;
                } else if (trimmed === 'EVENT_ALLOWED_FOR_AI') {
                    currentEntry.allowedForAI = true;
                } else if (trimmed.startsWith('VEH_PART ')) {
                    const parts = trimmed.substring(9).split(/\s+/);
                    currentEntry.vehPart = `${parts[0]} ${parts[1]}`;
                } else if (trimmed.startsWith('PARAM_DREF_IDX ')) {
                    currentEntry.paramDrefIdx = parseInt(trimmed.substring(15));
                }
            }
            }

        return entries;
        }

        // GENERATE MODE FUNCTION (same as before)
        async function generateSND() {
            if (!objFileContent) {
                alert('Please upload a cockpit.obj file first!');
                return;
            }

            const startTime = performance.now();

            document.getElementById('outputSection').classList.remove('hidden');
            clearConsole();
            document.getElementById('statsGrid').classList.add('hidden');
            document.getElementById('downloadBtn').classList.add('hidden');

            const progressBar = document.getElementById('progressBar');
            const progressFill = document.getElementById('progressFill');
            progressBar.classList.remove('hidden');
            progressFill.style.width = '10%';

            document.getElementById('generateBtn').disabled = true;

            log('Starting generation...', 'info');

            try {
                const parser = new OBJParser(objFileContent);
                const result = parser.parse();

                progressFill.style.width = '30%';
                log(`Found ${result.vertices.length} vertices`, 'success');
                log(`Found ${result.manipulators.length} manipulators`, 'success');

                const filters = getFilterSettings();
                const filteredManips = result.manipulators.filter(manip => {
                    if (filters.excludeDragAxis && manip.manipType === 'drag_axis') return false;
                    if (filters.excludeDragXY && manip.manipType === 'drag_xy') return false;
                    if (filters.excludeAxisKnob && manip.manipType === 'axis_knob') return false;
                    if (filters.excludeNoop && manip.manipType === 'noop') return false;
                    return true;
                });

                const filteredCount = result.manipulators.length - filteredManips.length;
                if (filteredCount > 0) {
                    log(`Filtered out ${filteredCount} manipulators`, 'warning');
                }

                progressFill.style.width = '60%';

                let layoutParent = document.getElementById('parentCategory').value.trim() || 'aircraft';
                let eventName = document.getElementById('eventName').value;

                if (eventName === 'custom') {
                    eventName = document.getElementById('customEventName').value || `/${layoutParent}/generic/switch`;
                } else {
                    // Replace the default "aircraft" root with the user's chosen root
                    eventName = eventName.replace(/^\/aircraft/, `/${layoutParent}`);
                }

                const useHoldCue = document.getElementById('useHoldCue').checked;
                const duplicateForRelease = document.getElementById('duplicateForRelease').checked;
                const outputFilename = document.getElementById('outputName').value || 'output.snd';

                const generator = new SNDGenerator(templateFileContent);
                const templateSounds = getTemplateSoundSettings();
                generatedContent = generator.generate(filteredManips, eventName, useHoldCue, duplicateForRelease, templateSounds);

                progressFill.style.width = '100%';

                const endTime = performance.now();
                const processingTime = Math.round(endTime - startTime);

                log('Generation complete!', 'success');

                const uniqueCommands = new Set(filteredManips.map(m => m.command)).size;
                const templateCount = Object.values(templateSounds).filter(v => v).length;
                const duplicatedCount = duplicateForRelease ? uniqueCommands * 2 : uniqueCommands;
                const totalEntries = duplicatedCount + templateCount;

                document.getElementById('statVertices').textContent = result.vertices.length.toLocaleString();
                document.getElementById('statManipulators').textContent = result.manipulators.length.toLocaleString();
                document.getElementById('statFiltered').textContent = uniqueCommands.toLocaleString();
                document.getElementById('statDuplicated').textContent = duplicatedCount.toLocaleString();
                document.getElementById('statTemplates').textContent = templateCount.toLocaleString();
                document.getElementById('statTotal').textContent = totalEntries.toLocaleString();
                document.getElementById('statTime').textContent = processingTime + 'ms';
                document.getElementById('statsGrid').classList.remove('hidden');

                // Parse generated content into entries and show review modal
                soundEntries = parseSNDToEntries(generatedContent);

                const downloadBtn = document.getElementById('downloadBtn');
                downloadBtn.classList.remove('hidden');
                downloadBtn.textContent = 'Review & Customize';

                // Use a direct onclick for reliability + logging
                downloadBtn.onclick = function (e) {
                    e.preventDefault();
                    console.log('Button clicked (onclick)! Output:', outputFilename);
                    console.log('Sound Entries count:', soundEntries ? soundEntries.length : 'null');

                    if (!soundEntries || soundEntries.length === 0) {
                        alert('No sound entries generated! Please check the console for parsing errors.');
                        return;
                    }

                    try {
                        openReviewModal(outputFilename);
                    } catch (err) {
                        console.error('CRITICAL: Failed to open modal:', err);
                        alert('Failed to open modal: ' + err.message);
                    }
                };

                log(`Button ready. Entries generated: ${soundEntries.length}`, 'info');

                log(`Generated ${totalEntries} total sound entries - Click "Review & Customize" to edit`, 'info');

                setTimeout(() => {
                    progressBar.classList.add('hidden');
                    progressFill.style.width = '0';
                }, 500);

            } catch (error) {
                log('ERROR: ' + error.message, 'error');
                progressFill.style.width = '0';
                setTimeout(() => progressBar.classList.add('hidden'), 500);
            }

            document.getElementById('generateBtn').disabled = false;
        }

        function downloadFile(content, filename) {
            const blob = new Blob([content], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            const consoleId = currentMode === 'update' ? 'consoleUpdate' : 'console';
            log('Downloaded: ' + filename, 'success', consoleId);
        }

        // ========================================================================
        // REVIEW MODAL FUNCTIONS
        // ========================================================================



        function openReviewModal(filename) {
            console.log('openReviewModal called with:', filename);
            currentFilename = filename;
            try {
                renderReviewModal();
                document.getElementById('reviewModal').classList.add('active');
                document.body.style.overflow = 'hidden';
                console.log('Review modal opened');
            } catch (e) {
                console.error('Error opening review modal:', e);
                alert('Error opening review modal: ' + e.message);
            }
        }

        function closeReviewModal() {
            document.getElementById('reviewModal').classList.remove('active');
            document.body.style.overflow = 'auto';
        }

        function renderReviewModal() {
            const body = document.getElementById('reviewBody');
            body.innerHTML = '';

            const filtered = getFilteredEntries();

            filtered.forEach((entry, index) => {
                const card = createEntryCard(entry, index);
                body.appendChild(card);
            });

            updateReviewStats();
        }

        function getFilteredEntries() {
            let entries = soundEntries;

            // Text Search
            if (searchText) {
                const lower = searchText.toLowerCase();
                entries = entries.filter(e =>
                    e.eventName.toLowerCase().includes(lower) ||
                    e.comment.toLowerCase().includes(lower) ||
                    e.command.toLowerCase().includes(lower) ||
                    e.startCond.toLowerCase().includes(lower)
                );
            }

            // Category/Status Filter
            switch (currentFilter) {
                case 'template':
                    return entries.filter(e => e.isTemplate);
                case 'manip':
                    return entries.filter(e => !e.isTemplate);
                case 'deleted':
                    return entries.filter(e => e.deleted);
                case 'pending':
                    return entries.filter(e => !e.deleted && !e.completed);
                case 'completed':
                    return entries.filter(e => !e.deleted && e.completed);
                case 'all':
                default:
                    return entries;
            }
        }

        function updateSearch(val) {
            searchText = val;
            renderReviewModal();
        }

        function toggleEntryComplete(entryId, completed) {
            const entry = soundEntries.find(e => e.id === entryId);
            if (entry) {
                entry.completed = completed;
                renderReviewModal();
            }
        }

        function toggleEntrySelected(entryId, selected) {
            const entry = soundEntries.find(e => e.id === entryId);
            if (entry) {
                entry.selected = selected;
                updateBulkActionsUI();
            }
        }

        function updateBulkActionsUI() {
            const selectedCount = soundEntries.filter(e => e.selected).length;
            document.getElementById('selectedCount').textContent = selectedCount;

            const panel = document.getElementById('bulkActionsPanel');
            if (selectedCount > 0) {
                panel.classList.remove('hidden');

                // Refresh categories in bulk dropdown
                const bulkCat = document.getElementById('bulkCategory');
                bulkCat.innerHTML = `<option value="">Set Category...</option>
                                     <option value="generic">Generic</option>
                                     ${userCategories.map(c => `<option value="${c}">${c}</option>`).join('')}`;
            } else {
                panel.classList.add('hidden');
            }
        }

        function applyBulkUpdate() {
            const selectedEntries = soundEntries.filter(e => e.selected);
            if (selectedEntries.length === 0) return;

            const category = document.getElementById('bulkCategory').value;
            const trigger = document.getElementById('bulkTrigger').value;

            selectedEntries.forEach(entry => {
                if (category) {
                    updateEntryCategory(entry.id, category);
                }
                if (trigger) {
                    entry.triggerType = trigger;
                }
            });

            log(`Bulk updated ${selectedEntries.length} entries`, 'success');
            renderReviewModal();
        }

        function updateReviewStats() {
            const total = soundEntries.length;
            const deleted = soundEntries.filter(e => e.deleted).length;
            const active = total - deleted;
            const template = soundEntries.filter(e => e.isTemplate && !e.deleted).length;
            const manip = soundEntries.filter(e => !e.isTemplate && !e.deleted).length;
            const pending = soundEntries.filter(e => !e.deleted && !e.completed).length;
            const completed = soundEntries.filter(e => !e.deleted && e.completed).length;

            document.getElementById('totalEntries').textContent = total;
            document.getElementById('activeEntries').textContent = active;
            document.getElementById('deletedEntries').textContent = deleted;
            document.getElementById('countAll').textContent = total;
            document.getElementById('countTemplate').textContent = template;
            document.getElementById('countManip').textContent = manip;
            document.getElementById('countDeleted').textContent = deleted;

            // New counters
            if (document.getElementById('countPending')) document.getElementById('countPending').textContent = pending;
            if (document.getElementById('countCompleted')) document.getElementById('countCompleted').textContent = completed;
        }

        function createEntryCard(entry) {
            const card = document.createElement('div');
            const isCompleted = entry.completed;
            const isSelected = entry.selected;

            card.className = `sound-entry ${entry.deleted ? 'deleted' : ''} ${isCompleted ? 'completed' : ''}`;
            card.id = `entry-${entry.id}`;

            if (entry.deleted) {
                card.innerHTML = `
                    <div class="entry-header">
                        <div class="entry-title" style="text-decoration: line-through; opacity: 0.6;">${escapeHtml(entry.comment || entry.eventName)}</div>
                        <div class="entry-controls">
                            <button class="entry-btn restore" onclick="restoreEntry('${entry.id}'); event.stopPropagation();">Restore</button>
                        </div>
                    </div>
                    <div style="padding: 1rem; text-align: center; color: var(--text-muted); font-size: 0.85rem;">
                        This entry will not be included in the final .snd file. Click "Restore" to add it back.
                    </div>
                `;
                return card;
            }

            card.innerHTML = `
                <div class="entry-header">
                    <div style="display: flex; align-items: center; gap: 0.5rem;">
                        <input type="checkbox" class="entry-select-checkbox" 
                               ${isSelected ? 'checked' : ''} 
                               onchange="toggleEntrySelected('${entry.id}', this.checked)">
                        <div class="entry-title">${escapeHtml(entry.comment || entry.eventName)}</div>
                    </div>
                    <div class="entry-controls">
                        <label style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.8rem; cursor: pointer; margin-right: 1rem;">
                            <input type="checkbox" ${isCompleted ? 'checked' : ''} 
                                   onchange="toggleEntryComplete('${entry.id}', this.checked)">
                            Mark Complete
                        </label>
                        <button class="entry-btn delete" onclick="deleteEntry('${entry.id}')">Delete</button>
                    </div>
                </div>
                
                <div class="entry-grid">
                    <div class="entry-field">
                        <label class="entry-label">Category</label>
                        <select class="entry-select" onchange="updateEntryCategory('${entry.id}', this.value)">
                            <option value="generic">Generic</option>
                            ${userCategories.map(c => `<option value="${c}" ${c === getCategoryFromEvent(entry.eventName) ? 'selected' : ''}>${c}</option>`).join('')}
                            <option value="custom">Custom (Type below)</option>
                        </select>
                    </div>

                    <div class="entry-field">
                        <label class="entry-label">Event Name</label>
                        <input type="text" class="entry-input" data-field="eventName" value="${escapeHtml(entry.eventName)}" 
                               onchange="updateEntryField('${entry.id}', 'eventName', this.value)">
                    </div>
                    
                    <div class="entry-field">
                        <label class="entry-label">Trigger Type</label>
                        <select class="entry-select" onchange="updateEntryField('${entry.id}', 'triggerType', this.value); renderReviewModal();">
                            <option value="EVENT_START_COND" ${entry.triggerType === 'EVENT_START_COND' ? 'selected' : ''}>Start/End Condition</option>
                            <option value="EVENT_CMND_DOWN" ${entry.triggerType === 'EVENT_CMND_DOWN' ? 'selected' : ''}>Command Pressed</option>
                            <option value="EVENT_CMND_UP" ${entry.triggerType === 'EVENT_CMND_UP' ? 'selected' : ''}>Command Released</option>
                            <option value="EVENT_CMND_HOLD_STOP" ${entry.triggerType === 'EVENT_CMND_HOLD_STOP' ? 'selected' : ''}>Hold to Play</option>
                            <option value="EVENT_CMND_HOLD_CUE" ${entry.triggerType === 'EVENT_CMND_HOLD_CUE' ? 'selected' : ''}>Press & Release Cue</option>
                            <option value="CUE_TRIGGER_COND" ${entry.triggerType === 'CUE_TRIGGER_COND' ? 'selected' : ''}>Cue Trigger</option>
                        </select>
                    </div>
                    
                    ${getTriggerFields(entry)}
                    
                    <div class="entry-field full-width">
                        <label class="entry-label">Auto-End Condition (Optional)</label>
                        <input type="text" class="entry-input" value="${escapeHtml(entry.autoEndCond)}" 
                               onchange="updateEntryField('${entry.id}', 'autoEndCond', this.value)"
                               placeholder="e.g., sim/flightmodel/gear/deploy_ratio[0] == 1">
                    </div>
                    
                    <div class="entry-field">
                        <label class="entry-label">XYZ Coordinates</label>
                        <input type="text" class="entry-input" value="${entry.xyz.map(v => v.toFixed(3)).join(', ')}" readonly style="opacity: 0.6;">
                    </div>
                    
                    <div class="entry-field">
                        <label class="entry-label">Advanced Options</label>
                        <div class="entry-checkbox-group">
                            <div class="entry-checkbox">
                                <input type="checkbox" id="poly-${entry.id}" ${entry.polyphonic ? 'checked' : ''}
                                       onchange="updateEntryField('${entry.id}', 'polyphonic', this.checked)">
                                <label for="poly-${entry.id}">Polyphonic</label>
                            </div>
                            <div class="entry-checkbox">
                                <input type="checkbox" id="ai-${entry.id}" ${entry.allowedForAI ? 'checked' : ''}
                                       onchange="updateEntryField('${entry.id}', 'allowedForAI', this.checked)">
                                <label for="ai-${entry.id}">Allowed for AI</label>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            return card;
        }

        // Helper to extract category for pre-selection
        function getCategoryFromEvent(eventName) {
            const parts = eventName.split('/');
            if (parts.length > 2) return parts[2];
            return 'generic';
        }

        function getTriggerFields(entry) {
            switch (entry.triggerType) {
                case 'EVENT_START_COND':
                    return `
                        <div class="entry-field full-width">
                            <label class="entry-label">Start Condition (Dataref)</label>
                            <input type="text" class="entry-input" value="${escapeHtml(entry.startCond)}" 
                                   onchange="updateEntryField('${entry.id}', 'startCond', this.value)"
                                   placeholder="e.g., sim/flightmodel/engine/ENGN_running[0] == 1">
                        </div>
                        <div class="entry-field full-width">
                            <label class="entry-label">End Condition (Dataref)</label>
                            <input type="text" class="entry-input" value="${escapeHtml(entry.endCond)}" 
                                   onchange="updateEntryField('${entry.id}', 'endCond', this.value)"
                                   placeholder="e.g., sim/flightmodel/engine/ENGN_running[0] == 0">
                        </div>
                    `;
                case 'EVENT_CMND_DOWN':
                case 'EVENT_CMND_UP':
                case 'EVENT_CMND_HOLD_STOP':
                case 'EVENT_CMND_HOLD_CUE':
                    return `
                        <div class="entry-field full-width">
                            <label class="entry-label">Command</label>
                            <input type="text" class="entry-input" value="${escapeHtml(entry.command)}" 
                                   onchange="updateEntryField('${entry.id}', 'command', this.value)"
                                   placeholder="e.g., sim/flight_controls/landing_gear_toggle">
                        </div>
                    `;
                case 'CUE_TRIGGER_COND':
                    return `
                        <div class="entry-field full-width">
                            <label class="entry-label">Cue Trigger Condition (Dataref)</label>
                            <input type="text" class="entry-input" value="${escapeHtml(entry.cueTrigger)}" 
                                   onchange="updateEntryField('${entry.id}', 'cueTrigger', this.value)"
                                   placeholder="e.g., sim/cockpit2/gauges/indicators/altitude_ft_pilot < 500">
                        </div>
                    `;
                default:
                    return '';
            }
        }

        function updateEntryField(entryId, field, value) {
            const entry = soundEntries.find(e => e.id === entryId);
            if (entry) {
                entry[field] = value;
                updateReviewStats();
            }
        }

        function deleteEntry(entryId) {
            const entry = soundEntries.find(e => e.id === entryId);
            if (entry) {
                entry.deleted = true;
                renderReviewModal();
            }
        }

        function restoreEntry(entryId) {
            const entry = soundEntries.find(e => e.id === entryId);
            if (entry) {
                entry.deleted = false;
                renderReviewModal();
            }
        }

        function filterEntries(filter) {
            currentFilter = filter;

            document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
            event.target.classList.add('active');

            renderReviewModal();
        }

        function updateReviewStats() {
            const total = soundEntries.length;
            const deleted = soundEntries.filter(e => e.deleted).length;
            const active = total - deleted;
            const template = soundEntries.filter(e => e.isTemplate && !e.deleted).length;
            const manip = soundEntries.filter(e => !e.isTemplate && !e.deleted).length;

            document.getElementById('totalEntries').textContent = total;
            document.getElementById('activeEntries').textContent = active;
            document.getElementById('deletedEntries').textContent = deleted;
            document.getElementById('countAll').textContent = total;
            document.getElementById('countTemplate').textContent = template;
            document.getElementById('countManip').textContent = manip;
            document.getElementById('countDeleted').textContent = deleted;
        }

        function downloadReviewedSND() {
            const header = generatedContent.split('BEGIN_SOUND_ATTACHMENT')[0];
            let content = header;

            soundEntries
                .filter(entry => !entry.deleted)
                .forEach(entry => {
                    content += entry.toSND();
                });

            downloadFile(content, currentFilename);
            closeReviewModal();

            log(`Downloaded customized .snd file with ${soundEntries.filter(e => !e.deleted).length} entries`, 'success');
        }

        // CATEGORY MANAGEMENT
        function addCategory() {
            const input = document.getElementById('categoryInput');
            const category = input.value.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');

            if (category && !userCategories.includes(category)) {
                userCategories.push(category);
                input.value = '';
                renderCategories();
            } else if (userCategories.includes(category)) {
                alert('Category already exists!');
            }
        }

        function removeCategory(index) {
            userCategories.splice(index, 1);
            renderCategories();
        }

        function renderCategories() {
            const list = document.getElementById('categoryList');
            if (!list) return; // Guard if UI not present

            list.innerHTML = userCategories.map((cat, i) => `
                <div class="category-chip">
                    ${cat}
                    <span onclick="removeCategory(${i})" style="cursor:pointer; margin-left:5px;">&times;</span>
                </div>
            `).join('');
        }

        function updateEntryCategory(entryId, category) {
            const entry = soundEntries.find(e => e.id === entryId);
            if (!entry) return;

            if (category === 'custom') {
                return; // Do nothing, let user edit manually
            }

            // Replace current "folder" in path
            // Assuming format /aircraft/FOLDER/name or /aircraft/name

            let parts = entry.eventName.split('/');
            // Standard path: ["", "aircraft", "generic", "name"] -> length 4

            if (category === 'generic') {
                // Reset to generic if possible, or just replace current category section
                if (parts.length >= 4) {
                    parts[2] = 'generic';
                    const newName = parts.join('/');
                    updateEntryField(entryId, 'eventName', newName);
                    // Also update the input field visually
                    const input = document.querySelector(`#entry-${entryId} input[data-field="eventName"]`);
                    if (input) input.value = newName;
                }
            } else {
                if (parts.length >= 4) {
                    parts[2] = category;
                    const newName = parts.join('/');
                    updateEntryField(entryId, 'eventName', newName);
                    // Also update the input field visually
                    const input = document.querySelector(`#entry-${entryId} input[data-field="eventName"]`);
                    if (input) input.value = newName;
                }
            }
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        // OBJ Parser (same as before)

        // COMPARE MODAL FUNCTIONS (NEW)


        function openCompareModal(diffs, totalEntries, matched, unmatched) {
            currentDiffs = diffs;
            document.getElementById('compareTotalChanges').textContent = diffs.length;
            document.getElementById('compareSelectedCount').textContent = diffs.length;
            document.getElementById('compareSelectAll').checked = true;

            // Store stats for later
            currentDiffs.stats = { totalEntries, matched, unmatched };

            renderCompareTable();
            document.getElementById('compareModal').classList.add('active');
            document.body.style.overflow = 'hidden';
        }

        function closeCompareModal() {
            document.getElementById('compareModal').classList.remove('active');
            document.body.style.overflow = 'auto';
            document.getElementById('updateBtn').disabled = false;
        }

        function renderCompareTable() {
            const tbody = document.getElementById('compareBody');
            tbody.innerHTML = '';

            if (currentDiffs.length === 0) {
                tbody.innerHTML = '<tr><td colspan="3" style="text-align: center; color: var(--text-muted);">No changes found.</td></tr>';
                return;
            }

            currentDiffs.forEach(diff => {
                const tr = document.createElement('tr');
                tr.className = `compare-row ${diff.selected ? '' : 'deselected'}`;

                tr.innerHTML = `
                    <td>
                        <input type="checkbox" ${diff.selected ? 'checked' : ''} 
                               onchange="toggleDiff(${diff.id}, this.checked)">
                    </td>
                    <td>
                        <div style="font-weight: 600; color: var(--accent); margin-bottom: 2px;">${escapeHtml(diff.eventName)}</div>
                        <div style="font-size: 0.8rem; font-family: monospace; background: rgba(0,0,0,0.2); padding: 2px 4px; border-radius: 3px; display: inline-block;">${escapeHtml(diff.command)}</div>
                        <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 2px;">Line ${diff.lineIndex + 1}</div>
                    </td>
                    <td>
                        <div style="margin-bottom: 4px;">
                            <span style="font-size: 0.75rem; color: var(--text-muted); display: inline-block; width: 30px;">OLD:</span>
                            <span class="diff-old" style="display: inline;">
                                ${diff.oldXYZ[0].toFixed(3)}, ${diff.oldXYZ[1].toFixed(3)}, ${diff.oldXYZ[2].toFixed(3)}
                            </span>
                        </div>
                        <div>
                            <span style="font-size: 0.75rem; color: var(--text-muted); display: inline-block; width: 30px;">NEW:</span>
                            <span class="diff-new" style="display: inline;">
                                ${diff.newXYZ[0].toFixed(3)}, ${diff.newXYZ[1].toFixed(3)}, ${diff.newXYZ[2].toFixed(3)}
                            </span>
                        </div>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        }

        function toggleDiff(id, checked) {
            const diff = currentDiffs.find(d => d.id === id);
            if (diff) {
                diff.selected = checked;
                renderCompareTable(); // Re-render to update opacity
                updateCompareCounts();
            }
        }

        function toggleAllCompare(checked) {
            currentDiffs.forEach(diff => diff.selected = checked);
            renderCompareTable();
            updateCompareCounts();
        }

        function updateCompareCounts() {
            const selected = currentDiffs.filter(d => d.selected).length;
            document.getElementById('compareSelectedCount').textContent = selected;
        }

        function applyUpdates() {
            const selectedChanges = currentDiffs.filter(d => d.selected);
            const stats = currentDiffs.stats;

            // Apply changes to the original content
            // Need to recreate the updater to access content easily, or just use the global
            const updater = new SNDUpdater(sndFileContent);
            const lines = [...updater.originalLines];

            selectedChanges.forEach(diff => {
                const tabs = diff.oldLine.match(/^\t*/)[0];
                lines[diff.lineIndex] = `${tabs}VEH_XYZ ${diff.newXYZ[0].toFixed(3)} ${diff.newXYZ[1].toFixed(3)} ${diff.newXYZ[2].toFixed(3)}`;
            });

            const updatedContent = lines.join('\n');
            const updatedCount = selectedChanges.length;

            closeCompareModal();

            // Finish the workflow (Update UI with results)
            log('Update complete!', 'success', 'consoleUpdate');
            log(`Updated ${updatedCount} coordinates`, 'success', 'consoleUpdate');

            if (stats.unmatched.length > 0) {
                log(`Warning: ${stats.unmatched.length} commands not found in OBJ`, 'warning', 'consoleUpdate');
                log('Unmatched commands:', 'warning', 'consoleUpdate');
                stats.unmatched.slice(0, 5).forEach(cmd => {
                    log(`  - ${cmd}`, 'warning', 'consoleUpdate');
                });
                if (stats.unmatched.length > 5) {
                    log(`  ... and ${stats.unmatched.length - 5} more`, 'warning', 'consoleUpdate');
                }
            }

            // Update stats grid
            document.getElementById('statEntriesFound').textContent = stats.totalEntries.toLocaleString();
            document.getElementById('statMatched').textContent = stats.matched.toLocaleString();
            document.getElementById('statUpdated').textContent = updatedCount.toLocaleString();
            document.getElementById('statUnmatched').textContent = stats.unmatched.length.toLocaleString();
            document.getElementById('statsGridUpdate').classList.remove('hidden');

            // Show download button
            const downloadBtn = document.getElementById('downloadBtnUpdate');
            downloadBtn.classList.remove('hidden');
            const outputFilename = document.getElementById('outputNameUpdate').value || 'updated.snd';
            downloadBtn.onclick = () => downloadFile(updatedContent, outputFilename);

            // Hide progress
            const progressBar = document.getElementById('progressBarUpdate');
            const progressFill = document.getElementById('progressFillUpdate');
            setTimeout(() => {
                progressBar.classList.add('hidden');
                progressFill.style.width = '0';
            }, 500);
        }

        // FMOD PACKAGE EXPORT FUNCTION
        async function exportFMODPackage() {
            if (!sndFileFmodContent) {
                alert('Please upload a .snd file!');
                return;
            }

            const startTime = performance.now();

            document.getElementById('outputSectionFmod').classList.remove('hidden');
            clearConsole('consoleFmod');
            document.getElementById('statsGridFmod').classList.add('hidden');
            document.getElementById('downloadBtnFmod').classList.add('hidden');

            const progressBar = document.getElementById('progressBarFmod');
            const progressFill = document.getElementById('progressFillFmod');
            progressBar.classList.remove('hidden');
            progressFill.style.width = '10%';

            document.getElementById('fmodExportBtn').disabled = true;

            log('Starting FMOD package generation...', 'info', 'consoleFmod');

            try {
                // Load JSZip dynamically
                if (typeof JSZip === 'undefined') {
                    log('Loading JSZip library...', 'info', 'consoleFmod');
                    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
                    progressFill.style.width = '20%';
                }

                const packageName = document.getElementById('packageName').value || 'aircraft_sounds';
                const createPlaceholders = document.getElementById('createPlaceholders').checked;
                const includeReadme = document.getElementById('includeReadme').checked;

                progressFill.style.width = '30%';

                // Parse SND file for event names
                const parser = new SNDEventParser(sndFileFmodContent);
                const events = parser.extractEvents();

                log(`Found ${events.length} unique event paths`, 'success', 'consoleFmod');
                progressFill.style.width = '50%';

                // Build FMOD package
                const builder = new FMODPackageBuilder(packageName, createPlaceholders, includeReadme);
                fmodPackageBlob = await builder.build(events);

                progressFill.style.width = '100%';

                const endTime = performance.now();
                const processingTime = Math.round(endTime - startTime);

                log('Package generation complete!', 'success', 'consoleFmod');
                log(`Created ${builder.stats.folders} folders and ${builder.stats.files} files`, 'info', 'consoleFmod');

                // Update stats
                document.getElementById('statEventsFound').textContent = events.length.toLocaleString();
                document.getElementById('statFolders').textContent = builder.stats.folders.toLocaleString();
                document.getElementById('statFiles').textContent = builder.stats.files.toLocaleString();
                document.getElementById('statPackageSize').textContent = (fmodPackageBlob.size / 1024).toFixed(1) + ' KB';
                document.getElementById('statTimeFmod').textContent = processingTime + 'ms';
                document.getElementById('statsGridFmod').classList.remove('hidden');

                // Show download button
                const downloadBtn = document.getElementById('downloadBtnFmod');
                downloadBtn.classList.remove('hidden');
                downloadBtn.onclick = () => {
                    const url = URL.createObjectURL(fmodPackageBlob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${packageName}_fmod_structure.zip`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                    log(`Downloaded: ${packageName}_fmod_structure.zip`, 'success', 'consoleFmod');
                };

                setTimeout(() => {
                    progressBar.classList.add('hidden');
                    progressFill.style.width = '0';
                }, 500);

            } catch (error) {
                log('ERROR: ' + error.message, 'error', 'consoleFmod');
                console.error(error);
                progressFill.style.width = '0';
                setTimeout(() => progressBar.classList.add('hidden'), 500);
            }

            document.getElementById('fmodExportBtn').disabled = false;
        }

        // Helper to load external scripts
        function loadScript(src) {
            return new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = src;
                script.onload = resolve;
                script.onerror = reject;
                document.head.appendChild(script);
            });
        }

        // SND Event Parser - extracts event paths from .snd file
    </script>
</body>

</html>