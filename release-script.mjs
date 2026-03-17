import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';

const type = process.argv[2] || 'patch';

try {
    // 1. 【安全检查】
    const status = execSync('git status --porcelain', { encoding: 'utf8' });
    if (status.trim().length > 0) {
        console.error('\n❌ 错误：工作区不干净，请先 commit！');
        process.exit(1);
    }

    // 2. 【构建阶段】
    console.log('🏗️  正在进行生产环境构建...');
    execSync('pnpm build', { stdio: 'inherit' });

    // 3. 【版本更新】
    const manifestPath = 'manifest.json';
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const oldVersion = manifest.version;
    const versionParts = oldVersion.split('.').map(Number);

    if (type === 'major') {
        versionParts[0] += 1;
        versionParts[1] = 0;
        versionParts[2] = 0;
    } else if (type === 'minor') {
        versionParts[1] += 1;
        versionParts[2] = 0;
    } else {
        versionParts[2] += 1;
    }

    const newVersion = versionParts.join('.');
    manifest.version = newVersion;
    writeFileSync(manifestPath, JSON.stringify(manifest, null, '\t'));
    console.log(`\n✅ 版本更新: ${oldVersion} -> ${newVersion}`);

    // 4. 【生成 CHANGELOG】
    console.log('📝 正在更新 CHANGELOG.md...');
    let changelogContent = '';
    try {
        // 获取上一个 Tag 之后的 commit 记录
        const lastTag = execSync('git describe --tags --abbrev=0', { encoding: 'utf8' }).trim();
        changelogContent = execSync(`git log ${lastTag}..HEAD --oneline --no-merges`, { encoding: 'utf8' });
    } catch (e) {
        // 如果从未打过 Tag，则获取所有记录
        changelogContent = execSync(`git log --oneline --no-merges`, { encoding: 'utf8' });
    }

    // 过滤掉 release 自身的 commit 信息
    const logs = changelogContent
        .split('\n')
        .filter(line => line.trim() && !line.includes('chore: release'))
        .map(line => `- ${line.split(' ').slice(1).join(' ')}`) // 去掉 commit hash
        .join('\n');

    const date = new Date().toISOString().split('T')[0];
    const newEntry = `## [${newVersion}] - ${date}\n\n${logs || '- 优化了一些细节'}\n\n`;

    // 读取旧内容并追加
    const changelogPath = 'CHANGELOG.md';
    const oldChangelog = existsSync(changelogPath) ? readFileSync(changelogPath, 'utf8') : '';
    writeFileSync(changelogPath, newEntry + oldChangelog);

    // 5. 【Git 自动化】
    console.log('🚀 正在推送到 GitHub...');
    execSync('git add .');
    execSync(`git commit -m "chore: release ${newVersion}"`);
    execSync(`git tag ${newVersion}`);
    execSync('git push');
    execSync('git push --tags');

    console.log(`\n🎉 发布完成！版本 ${newVersion} 已上线。`);
} catch (error) {
    console.error('\n❌ 发布中止:', error.message);
    process.exit(1);
}