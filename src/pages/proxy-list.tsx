import Frog2Image from '@/assets/images/frog-2.png';
import Frog3Image from '@/assets/images/frog-3.png';
import { useAppStore } from '@/store';
import { faTrash } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React, { type FC } from 'react';

const ProxyList: FC = () => {
    const { proxies, setProxies } = useAppStore();
    const proxyText = proxies.join('\n');

    const handleClear = () => setProxies([]);

    const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const newText = e.target.value;
        const newProxies = newText.split('\n').filter((line: string) => line.trim() !== '');
        setProxies(newProxies);
    };

    return (
        <div className='flex h-full flex-col overflow-hidden rounded-lg border border-emerald-200 bg-linear-to-br from-white to-emerald-50 shadow-sm'>
            {proxies.length > 0 && (
                <div className='flex justify-between border-b border-emerald-200 p-3'>
                    <img src={Frog3Image} alt='' className='h-8 w-8' />
                    <button onClick={handleClear}>
                        <FontAwesomeIcon icon={faTrash} />
                    </button>
                </div>
            )}
            {proxies.length === 0 ? (
                <div className='flex flex-1 items-center justify-center rounded-lg border border-emerald-200 bg-linear-to-br from-white to-emerald-50 shadow-sm'>
                    <div className='flex flex-col items-center gap-4'>
                        <img src={Frog2Image} alt='empty' className='h-32 w-32' />
                        <p className='text-xl font-semibold text-emerald-500'>Ếch đang đợi bạn nhấn GEN</p>
                    </div>
                </div>
            ) : (
                <textarea value={proxyText} onChange={handleTextChange} className='flex-1 resize-none rounded-lg border-none p-3 font-mono text-sm text-gray-700 focus:outline-none' placeholder='host:port:user:pass' />
            )}
        </div>
    );
};

export default ProxyList;
