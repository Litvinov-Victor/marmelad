const fs = require('fs');

module.exports = (name, techs) => {
  const blockPath = `marmelad/_blocks/${name}`;
  const settings = require(`${process.cwd()}/marmelad/settings.marmelad`);
  const extensions = techs || 'html,css,js,json'.replace('css', settings.app.css || 'css');

  if (fs.existsSync(blockPath)) {
    process.stdout.write(`⚠  block ${name} is already exists`);
  } else {
    fs.mkdirSync(blockPath);

    extensions.split(',').forEach((ext) => {
      fs.writeFileSync(`${blockPath}/${name}.${ext}`, '', { encoding: 'utf8' });
    });

    process.stdout.write(`✔  block ${name} is created`);
  }

  process.exit();
};
