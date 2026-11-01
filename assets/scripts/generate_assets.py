import bpy
import math
import random
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / 'assets'
BLEND = ASSETS / 'blend'
GLB = ASSETS / 'glb'
SPRITES = ASSETS / 'sprites'
TEXTURES = ASSETS / 'textures'
ART = ROOT / 'art'
for folder in (BLEND, GLB, SPRITES, TEXTURES, ART):
    folder.mkdir(parents=True, exist_ok=True)
random.seed(1707)
MAT = {}
ROOT_OBJECT = None


def material(key, color, roughness=0.42, metallic=0.0, emission=0.0):
    mat = bpy.data.materials.new(key)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = metallic
    if emission:
        bsdf.inputs['Emission Color'].default_value = (*color, 1)
        bsdf.inputs['Emission Strength'].default_value = emission
    MAT[key] = mat
    return mat


def make_palette():
    material('pearl', (0.92, 0.84, 0.70), 0.25, 0.08)
    material('white', (0.98, 0.95, 0.86), 0.3)
    material('coral', (0.88, 0.24, 0.18), 0.38)
    material('coral_light', (1.0, 0.48, 0.37), 0.35)
    material('ultramarine', (0.10, 0.20, 0.58), 0.32)
    material('ink', (0.025, 0.055, 0.12), 0.46)
    material('water', (0.025, 0.20, 0.38), 0.2, 0.18)
    material('sand', (0.70, 0.62, 0.46), 0.65)
    material('stone', (0.20, 0.30, 0.39), 0.7)
    material('wood', (0.30, 0.15, 0.12), 0.6)
    material('gold', (0.88, 0.58, 0.20), 0.26, 0.55)
    material('aqua', (0.22, 0.70, 0.72), 0.28, 0.12)
    material('glow', (0.70, 0.92, 1.0), 0.18, 0.0, 3.0)
    image = bpy.data.images.new('pearl-microtexture', width=64, height=64)
    pixels = []
    for y in range(64):
        for x in range(64):
            wave = 0.78 + 0.12 * math.sin(x * 0.43 + y * 0.17) + random.random() * 0.07
            pixels.extend((wave, wave * 0.96, wave * 0.88, 1))
    image.pixels = pixels
    image.filepath_raw = str(TEXTURES / 'pearl-microtexture.png')
    image.file_format = 'PNG'
    image.save()
    image.pack()
    nodes = MAT['pearl'].node_tree.nodes
    links = MAT['pearl'].node_tree.links
    texture = nodes.new('ShaderNodeTexImage')
    texture.image = image
    texture.label = 'Original generated nacre texture'
    bump = nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = 0.12
    bump.inputs['Distance'].default_value = 0.06
    links.new(texture.outputs['Color'], bump.inputs['Height'])
    links.new(bump.outputs['Normal'], nodes.get('Principled BSDF').inputs['Normal'])


def clear_scene():
    global ROOT_OBJECT
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    ROOT_OBJECT = bpy.data.objects.new('AssetRoot', None)
    bpy.context.collection.objects.link(ROOT_OBJECT)
    ROOT_OBJECT.animation_data_clear()


def assign(obj, mat):
    if mat:
        obj.data.materials.append(MAT[mat] if isinstance(mat, str) else mat)
    obj.parent = ROOT_OBJECT
    return obj


def smooth(obj):
    if obj.type == 'MESH':
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
    return obj


def cube(name, loc, scale, mat='pearl', bevel=0.06):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    assign(obj, mat)
    if bevel:
        modifier = obj.modifiers.new('Soft miniature edges', 'BEVEL')
        modifier.width = bevel
        modifier.segments = 2
        obj.modifiers.new('Weighted normals', 'WEIGHTED_NORMAL')
    return obj


def sphere(name, loc, scale, mat='pearl', subdivisions=2):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdivisions, radius=1, location=loc)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    assign(obj, mat)
    return smooth(obj)


def cylinder(name, loc, radius, depth, mat='pearl', vertices=12, rotation=None):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=loc)
    obj = bpy.context.object
    obj.name = name
    if rotation:
        obj.rotation_euler = rotation
    assign(obj, mat)
    bevel = obj.modifiers.new('Rounded rims', 'BEVEL')
    bevel.width = min(radius * 0.12, 0.05)
    bevel.segments = 2
    obj.modifiers.new('Weighted normals', 'WEIGHTED_NORMAL')
    return obj


def cone(name, loc, r1, r2, depth, mat='pearl', vertices=12):
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=r1, radius2=r2, depth=depth, location=loc)
    obj = bpy.context.object
    obj.name = name
    assign(obj, mat)
    return obj


def torus(name, loc, major, minor, mat='pearl', rotation=None):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, major_segments=24, minor_segments=8, location=loc)
    obj = bpy.context.object
    obj.name = name
    if rotation:
        obj.rotation_euler = rotation
    assign(obj, mat)
    return smooth(obj)


def beam_between(name, start, end, radius, mat='coral'):
    start, end = Vector(start), Vector(end)
    delta = end - start
    obj = cylinder(name, (start + end) / 2, radius, delta.length, mat, 8)
    obj.rotation_euler = delta.to_track_quat('Z', 'Y').to_euler()
    return obj


def mesh_obj(name, vertices, faces, mat):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    assign(obj, mat)
    return obj


def coral_branch(loc, scale=1.0, mat='coral'):
    x, y, z = loc
    beam_between('Coral stem', (x, y, z), (x, y, z + 0.55 * scale), 0.07 * scale, mat)
    for angle in (0.3, 2.4, 4.5):
        end = (x + math.cos(angle) * 0.30 * scale, y + math.sin(angle) * 0.30 * scale, z + 0.82 * scale)
        beam_between('Coral crown', (x, y, z + 0.35 * scale), end, 0.055 * scale, mat)
        sphere('Coral polyp', end, (0.09 * scale,) * 3, 'coral_light', 1)


def shell_roof(loc, scale=1.0, mat='pearl'):
    x, y, z = loc
    sphere('Nacre shell', (x, y, z), (0.60 * scale, 0.46 * scale, 0.38 * scale), mat, 3)
    for i in range(5):
        rib = torus('Shell rib', (x, y - 0.05 * i * scale, z + 0.02 * i * scale), (0.47 - i * 0.055) * scale, 0.022 * scale, 'white', (math.pi / 2, 0, 0))
        rib.scale.y = 0.72


def make_reef(index):
    clear_scene()
    rng = random.Random(100 + index)
    sphere('Sculpted reef base', (0, 0, -0.16), (1.35, 1.02, 0.30), 'sand' if index % 2 else 'pearl', 3)
    for j in range(4 + index % 3):
        angle = j * 2.1 + index
        radius = 0.25 + 0.55 * rng.random()
        sphere('Reef rock', (math.cos(angle) * radius, math.sin(angle) * radius, 0.10 + rng.random() * 0.12),
               (0.35 + rng.random() * 0.25, 0.30 + rng.random() * 0.20, 0.22 + rng.random() * 0.40), 'stone' if index >= 4 else 'pearl')
    if index < 4:
        for j in range(2 + index % 2):
            coral_branch((-0.55 + j * 0.48, 0.15 * (-1) ** j, 0.18), 0.65 + 0.12 * index, 'coral' if j % 2 == 0 else 'aqua')
    if index == 5:
        cone('Sea needle', (0.15, 0, 0.85), 0.38, 0.05, 1.55, 'ink', 7)
    finish_asset(f'reef-{index + 1:02d}', 3.7, (0, 0, 0.25), animation=None)


def sail_mesh(name, loc, width, height, mat, style='fan'):
    x, y, z = loc
    if style == 'split':
        vertices = [(x, y, z), (x - width, y, z + height * 0.2), (x - width * 0.25, y - 0.10, z + height),
                    (x, y, z + height * 0.68), (x + width * 0.75, y + 0.08, z + height * 0.90), (x + width * 0.45, y, z + height * 0.18)]
        faces = [(0, 1, 2, 3), (0, 3, 4, 5)]
    elif style == 'crescent':
        vertices = [(x, y, z), (x - width, y + 0.06, z + height * 0.35), (x - width * 0.45, y - 0.08, z + height),
                    (x + width * 0.65, y, z + height * 0.85), (x + width, y + 0.08, z + height * 0.22)]
        faces = [(0, 1, 2, 3, 4)]
    else:
        vertices = [(x, y, z), (x - width, y, z + height * 0.25), (x - width * 0.75, y - 0.12, z + height * 0.85),
                    (x, y, z + height), (x + width * 0.75, y + 0.12, z + height * 0.85), (x + width, y, z + height * 0.25)]
        faces = [(0, 1, 2, 3, 4, 5)]
    obj = mesh_obj(name, vertices, faces, mat)
    solid = obj.modifiers.new('Woven sail thickness', 'SOLIDIFY')
    solid.thickness = 0.025
    return obj


def hull(length, width, mat='wood'):
    z = 0.28
    vertices = [(-width, -length * 0.38, z), (width, -length * 0.38, z), (width * 0.85, length * 0.25, z),
                (0, length * 0.55, z + 0.08), (-width * 0.85, length * 0.25, z),
                (-width * 0.72, -length * 0.34, 0), (width * 0.72, -length * 0.34, 0),
                (width * 0.60, length * 0.20, 0), (0, length * 0.46, 0.05), (-width * 0.60, length * 0.20, 0)]
    faces = [(0, 1, 2, 3, 4), (0, 5, 6, 1), (1, 6, 7, 2), (2, 7, 8, 3), (3, 8, 9, 4), (4, 9, 5, 0), (5, 9, 8, 7, 6)]
    obj = mesh_obj('Carved hull', vertices, faces, mat)
    bevel = obj.modifiers.new('Hull polish', 'BEVEL')
    bevel.width = 0.08
    bevel.segments = 2
    obj.modifiers.new('Hull normals', 'WEIGHTED_NORMAL')
    cube('Pearl deck', (0, -0.02, z + 0.03), (width * 1.45, length * 0.64, 0.09), 'pearl', 0.04)
    return obj


def emblem(faction, z, mat):
    if faction == 'nacre':
        torus('Crown shell emblem', (0, -0.07, z), 0.14, 0.035, mat, (math.pi / 2, 0, 0))
    elif faction == 'coral':
        coral_branch((0, -0.08, z - 0.12), 0.33, mat)
    else:
        for i in range(4):
            ray = cube('Compass emblem', (0, -0.08, z), (0.035, 0.03, 0.32), mat, 0.01)
            ray.rotation_euler.y = i * math.pi / 4


def make_ship(unit, faction='nacre', save=True):
    clear_scene()
    if unit == 'scout':
        length, width = 1.55, 0.36
    elif unit == 'colonizer':
        length, width = 1.75, 0.55
    elif unit == 'escort':
        length, width = 1.90, 0.62
    else:
        length, width = 1.65, 0.52
    hull(length, width)
    sail_color = {'nacre': 'pearl', 'coral': 'coral', 'outremer': 'ultramarine'}[faction]
    accent = {'nacre': 'coral', 'coral': 'white', 'outremer': 'pearl'}[faction]
    style = {'nacre': 'fan', 'coral': 'split', 'outremer': 'crescent'}[faction]
    mast = cylinder('Mast', (0, 0, 1.12), 0.045, 1.65, 'wood', 10)
    sail = sail_mesh('Distinctive sail', (0, 0, 0.72), 0.68 if unit != 'scout' else 0.52, 1.05, sail_color, style)
    emblem(faction, 1.25, accent)
    if unit == 'colonizer':
        shell_roof((0, -0.52, 0.62), 0.55)
        cube('Settlement crates', (0.35, 0.30, 0.55), (0.28, 0.32, 0.28), 'wood')
    elif unit == 'escort':
        for side in (-1, 1):
            for y in (-0.45, 0.05, 0.50):
                shield = cylinder('Escort shield', (side * 0.61, y, 0.50), 0.18, 0.06, accent, 10, (0, math.pi / 2, 0))
        cylinder('Second mast', (0, -0.60, 0.98), 0.035, 1.10, 'wood', 8)
    elif unit == 'bomber':
        cube('Ballista platform', (0, 0.47, 0.60), (0.65, 0.60, 0.18), 'ink')
        beam_between('Ballista arm', (-0.55, 0.48, 0.80), (0.55, 0.48, 0.80), 0.055, 'gold')
        beam_between('Ballista rail', (0, 0.05, 0.76), (0, 0.95, 0.85), 0.06, 'wood')
    else:
        cone('Lookout basket', (0, 0, 1.93), 0.17, 0.13, 0.20, 'coral', 10)
    ROOT_OBJECT['assetKind'] = 'ship'
    ROOT_OBJECT['unitId'] = unit
    ROOT_OBJECT['factionId'] = faction
    for frame, z, roll in ((1, 0, -0.02), (25, 0.10, 0.025), (49, 0, -0.02)):
        ROOT_OBJECT.location.z = z
        ROOT_OBJECT.rotation_euler.y = roll
        ROOT_OBJECT.keyframe_insert(data_path='location', frame=frame, group='Navigation')
        ROOT_OBJECT.keyframe_insert(data_path='rotation_euler', frame=frame, group='Navigation')
    for frame, angle in ((1, -0.025), (25, 0.04), (49, -0.025)):
        sail.rotation_euler.z = angle
        sail.keyframe_insert(data_path='rotation_euler', frame=frame, group='Sail wind')
    for frame, scale in ((1, 1), (8, 0.90), (15, 1.05), (24, 1)):
        ROOT_OBJECT.scale = (scale, scale, scale)
        ROOT_OBJECT.keyframe_insert(data_path='scale', frame=frame, group='Impact')
    if save:
        name = unit if faction == 'nacre' else f'{unit}-{faction}'
        finish_asset(name, 3.4, (0, 0, 0.85), animation='Navigation, sail and impact')
        if faction == 'nacre':
            (SPRITES / f'{unit}-{faction}.png').write_bytes((SPRITES / f'{unit}.png').read_bytes())
    return ROOT_OBJECT


def dock(loc=(0, 0, 0), length=1.8):
    x, y, z = loc
    for i in range(7):
        cube('Quay plank', (x, y - length / 2 + i * length / 6, z + 0.28), (0.72, length / 7 * 0.92, 0.10), 'wood', 0.025)
    for side in (-1, 1):
        for yy in (-length / 2, 0, length / 2):
            cylinder('Stilt', (x + side * 0.31, y + yy, z), 0.065, 0.75, 'pearl', 8)


def crane(loc=(0, 0, 0)):
    x, y, z = loc
    beam_between('Crane mast', (x, y, z), (x, y, z + 1.4), 0.07, 'wood')
    beam_between('Crane arm', (x, y, z + 1.3), (x + 0.85, y, z + 1.15), 0.06, 'pearl')
    beam_between('Crane cable', (x + 0.78, y, z + 1.15), (x + 0.78, y, z + 0.55), 0.018, 'ink')


def crate(loc=(0, 0, 0), scale=1.0):
    x, y, z = loc
    cube('Supply crate', (x, y, z + 0.22 * scale), (0.42 * scale, 0.42 * scale, 0.42 * scale), 'wood', 0.035)
    for angle in (0, math.pi / 2):
        band = cube('Crate band', (x, y, z + 0.22 * scale), (0.45 * scale, 0.07 * scale, 0.45 * scale), 'pearl', 0.015)
        band.rotation_euler.z = angle


def make_port():
    clear_scene()
    sphere('Port reef', (0, 0, -0.12), (1.35, 1.10, 0.32), 'pearl', 3)
    dock((-0.85, 0.0, 0), 1.7)
    dock((0.75, 0.25, 0), 1.3)
    shell_roof((0.1, 0.10, 0.55), 1.0)
    shell_roof((0.65, -0.45, 0.38), 0.55)
    cylinder('Harbor banner mast', (-0.25, -0.60, 0.82), 0.035, 1.45, 'wood', 8)
    sail_mesh('Harbor banner', (-0.25, -0.60, 0.85), 0.30, 0.50, 'coral', 'split')
    coral_branch((-0.65, 0.65, 0.10), 0.65)
    finish_asset('port', 4.1, (0, 0, 0.45), animation='Construction')


def make_building(kind):
    clear_scene()
    cylinder('Building foundation', (0, 0, 0.10), 0.85, 0.22, 'pearl', 12)
    if kind == 'market':
        for x in (-0.48, 0.48):
            for y in (-0.35, 0.35):
                cylinder('Market stilt', (x, y, 0.52), 0.045, 0.85, 'wood', 8)
        shell_roof((0, 0, 0.90), 1.05, 'coral_light')
        crate((0.25, -0.15, 0.22), 0.7)
    elif kind == 'shipyard':
        dock((0, 0, 0.05), 1.35)
        crane((-0.45, 0.1, 0.25))
        hull(0.9, 0.28, 'coral')
    elif kind == 'academy':
        cylinder('Academy drum', (0, 0, 0.55), 0.58, 0.80, 'pearl', 16)
        shell_roof((0, 0, 1.0), 1.0)
        sphere('Pearl of knowledge', (0, -0.58, 0.75), (0.18,) * 3, 'glow', 3)
    elif kind == 'bastion':
        for x in (-0.45, 0.45):
            cone('Coral bastion tower', (x, 0, 0.65), 0.34, 0.26, 1.05, 'coral', 8)
            cone('Shell battlement', (x, 0, 1.25), 0.40, 0.10, 0.35, 'pearl', 8)
        cube('Bastion gate', (0, 0, 0.48), (0.55, 0.45, 0.65), 'ink')
    elif kind == 'drydock':
        for x in (-0.50, 0.50):
            dock((x, 0, 0.05), 1.4)
        crane((-0.60, 0.25, 0.20))
        torus('Spiral drydock wheel', (0.45, -0.35, 0.75), 0.32, 0.06, 'aqua', (math.pi / 2, 0, 0))
    for frame, value in ((1, 0.05), (24, 1.08), (36, 1.0), (49, 1.0)):
        ROOT_OBJECT.scale = (value, value, value)
        ROOT_OBJECT.keyframe_insert(data_path='scale', frame=frame, group='Construction')
    finish_asset(kind, 3.1, (0, 0, 0.55), animation='Construction')


def make_lighthouse():
    clear_scene()
    sphere('Lighthouse reef', (0, 0, -0.10), (1.15, 1.0, 0.28), 'pearl', 3)
    cone('Tapered nacre tower', (0, 0, 1.05), 0.52, 0.30, 2.0, 'pearl', 16)
    for z in (0.45, 1.15, 1.70):
        torus('Coral tower ring', (0, 0, z), 0.47 - z * 0.09, 0.055, 'coral')
    cylinder('Lantern room', (0, 0, 2.15), 0.44, 0.48, 'ink', 12)
    sphere('Pharos pearl', (0, 0, 2.18), (0.24,) * 3, 'glow', 3)
    cone('Shell spire', (0, 0, 2.62), 0.62, 0.03, 0.55, 'coral', 16)
    beam = cone('Activation beam', (0, 0, 3.65), 0.38, 0.03, 2.4, 'glow', 24)
    for frame, scale, energy in ((1, 0.01, 0), (18, 0.01, 0), (36, 1.0, 5), (49, 0.75, 3)):
        beam.scale = (scale, scale, 1)
        beam.keyframe_insert(data_path='scale', frame=frame, group='Lighthouse activation')
    finish_asset('great-lighthouse', 5.2, (0, 0, 1.35), animation='Lighthouse activation')


def make_ruin(kind):
    clear_scene()
    sphere('Ancient reef', (0, 0, -0.10), (1.0, 0.85, 0.24), 'stone', 2)
    if kind == 'archive':
        for x in (-0.48, 0, 0.48):
            cylinder('Archive column', (x, 0.12, 0.55), 0.12, 1.1 - abs(x) * 0.5, 'pearl', 8)
        sphere('Memory pearl', (0, -0.25, 0.38), (0.25,) * 3, 'glow', 3)
        torus('Archive halo', (0, -0.25, 0.38), 0.38, 0.035, 'gold', (math.pi / 2, 0, 0))
    elif kind == 'cache':
        crate((-0.30, 0, 0.12), 1.0)
        crate((0.30, 0.20, 0.12), 0.8)
        crate((0.05, -0.28, 0.50), 0.65)
        coral_branch((0.55, -0.25, 0.05), 0.55, 'aqua')
    else:
        torus('Broken tide ring', (0, 0, 0.55), 0.58, 0.10, 'pearl', (math.pi / 2, 0, 0))
        cylinder('Tide beacon', (0, 0, 0.45), 0.18, 0.90, 'ink', 8)
        sphere('Tide flame', (0, 0, 1.02), (0.16, 0.16, 0.28), 'glow', 2)
    finish_asset(f'ruin-{kind}', 3.0, (0, 0, 0.40), animation='Discovery glow')


def setup_studio(scale, target):
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE_NEXT'
    scene.render.resolution_x = 256
    scene.render.resolution_y = 256
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.film_transparent = True
    scene.render.image_settings.color_depth = '8'
    scene.render.fps = 24
    scene.frame_start = 1
    scene.frame_end = 49
    scene.world.color = (0.035, 0.05, 0.10)
    bpy.ops.object.camera_add(location=(5.5, -7.5, 6.2))
    camera = bpy.context.object
    camera.name = 'Studio camera'
    camera.rotation_euler = (Vector(target) - camera.location).to_track_quat('-Z', 'Y').to_euler()
    camera.data.type = 'ORTHO'
    camera.data.ortho_scale = scale
    scene.camera = camera
    for name, loc, energy, size, color in (
        ('Nacre key', (1, -4, 7), 750, 5, (1.0, 0.86, 0.73)),
        ('Ultramarine fill', (-4, -1, 3), 500, 4, (0.45, 0.62, 1.0)),
        ('Coral rim', (3, 4, 5), 850, 3, (1.0, 0.45, 0.32)),
    ):
        bpy.ops.object.light_add(type='AREA', location=loc)
        light = bpy.context.object
        light.name = name
        light.data.energy = energy
        light.data.shape = 'DISK'
        light.data.size = size
        light.data.color = color
        light.rotation_euler = (Vector(target) - light.location).to_track_quat('-Z', 'Y').to_euler()
    scene.view_settings.view_transform = 'AgX'


def finish_asset(name, scale, target, animation=None):
    scene = bpy.context.scene
    scene.frame_set(25 if animation else 1)
    setup_studio(scale, target)
    if animation:
        ROOT_OBJECT['animations'] = animation
    bpy.ops.object.select_all(action='DESELECT')
    ROOT_OBJECT.select_set(True)
    for obj in ROOT_OBJECT.children_recursive:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = ROOT_OBJECT
    bpy.ops.export_scene.gltf(filepath=str(GLB / f'{name}.glb'), export_format='GLB', use_selection=True,
                              export_animations=bool(animation), export_frame_range=True, export_force_sampling=True)
    blend_path = BLEND / f'{name}.blend'
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))
    scene.render.filepath = str(SPRITES / f'{name}.png')
    bpy.ops.render.render(write_still=True)
    print(f'ASSET_READY {name}', flush=True)


def accessory(name):
    clear_scene()
    if name == 'dock':
        dock()
    elif name == 'sail':
        cylinder('Sail mast', (0, 0, 0.75), 0.05, 1.5, 'wood')
        sail_mesh('Accessory sail', (0, 0, 0.35), 0.75, 1.15, 'pearl', 'fan')
    elif name == 'beacon':
        cylinder('Beacon base', (0, 0, 0.25), 0.35, 0.50, 'pearl')
        sphere('Beacon light', (0, 0, 0.72), (0.22,) * 3, 'glow', 3)
        torus('Beacon crown', (0, 0, 0.72), 0.35, 0.04, 'coral')
    elif name == 'crates':
        crate((-0.25, 0, 0))
        crate((0.28, 0.15, 0), 0.8)
        crate((0, -0.20, 0.40), 0.7)
    elif name == 'quay':
        dock((-0.45, 0, 0), 1.8)
        dock((0.45, 0, 0), 1.8)
    elif name == 'shell-house':
        shell_roof((0, 0, 0.55), 1.2)
        cylinder('House stilts', (0, 0, 0.25), 0.55, 0.50, 'wood')
    elif name == 'port-crane':
        crane()
    finish_asset(name, 3.0, (0, 0, 0.55), animation='Sail wind' if name == 'sail' else None)


def make_cover():
    clear_scene()
    bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -0.42))
    assign(bpy.context.object, 'water')
    for index, loc in enumerate(((-2.3, 0.8, 0), (0.0, 1.3, 0), (2.2, 0.3, 0), (-0.8, -1.6, 0), (1.6, -1.7, 0))):
        sphere('Cover reef', loc, (1.25, 0.95, 0.30), 'pearl', 3)
        coral_branch((loc[0] - 0.45, loc[1], loc[2] + 0.1), 1.0)
    cone('Cover lighthouse', (0, 1.3, 1.25), 0.55, 0.30, 2.4, 'pearl', 16)
    cone('Cover lighthouse crown', (0, 1.3, 2.65), 0.65, 0.05, 0.55, 'coral', 16)
    sphere('Cover lantern', (0, 1.3, 2.35), (0.26,) * 3, 'glow', 3)
    for loc in ((-2.2, 0.8, 0.45), (1.6, -1.7, 0.45)):
        shell_roof(loc, 1.2)
    scene = bpy.context.scene
    setup_studio(10.5, (0, 0, 0.45))
    scene.camera.location = (7, -11, 9)
    scene.camera.rotation_euler = (Vector((0, 0, 0.4)) - scene.camera.location).to_track_quat('-Z', 'Y').to_euler()
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 720
    scene.render.filepath = str(ART / 'cover.png')
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND / 'cover-scene.blend'))
    bpy.ops.render.render(write_still=True)
    print('ASSET_READY cover', flush=True)


def main():
    make_palette()
    for index in range(6):
        make_reef(index)
    for unit in ('scout', 'colonizer', 'escort', 'bomber'):
        for faction in ('nacre', 'coral', 'outremer'):
            make_ship(unit, faction)
    make_port()
    for kind in ('market', 'shipyard', 'academy', 'bastion', 'drydock'):
        make_building(kind)
    make_lighthouse()
    for kind in ('archive', 'cache', 'beacon'):
        make_ruin(kind)
    for name in ('dock', 'quay', 'sail', 'beacon', 'crates', 'shell-house', 'port-crane'):
        accessory(name)
    make_cover()
    print(f'COMPLETE {len(list(BLEND.glob("*.blend")))} blend files, {len(list(GLB.glob("*.glb")))} GLB files', flush=True)


if __name__ == '__main__':
    main()
